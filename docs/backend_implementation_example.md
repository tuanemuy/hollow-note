# Backend Implementation Guide

The Note and Identity domains are the canonical examples. When adding a new domain, just follow the same structure.

> For principles and abstract concepts, see `CLAUDE.md`. For the design this code implements, see `spec/` — port contracts in `spec/domains/`, flows in `spec/usecases/`, and the decisions behind both in `spec/adr/`. This document is a collection of copy-and-adapt patterns for "how to actually write the code".

## File Layout

```
packages/core/src/
├── domain/                             pure business logic; no I/O, no framework, no ambient time
│   ├── common/
│   │   ├── event.ts                    DomainEventBase, EventDraft, EventDecoder, WithEventDrafts, attachEventIds
│   │   ├── transactionalRepository.ts  TransactionalRepository, Versioned, ExpectedVersion
│   │   ├── pagination.ts               Pagination, PaginationResult, PrunePage
│   │   ├── version.ts
│   │   └── time.ts
│   ├── error.ts                        BusinessRuleError, RehydrationError
│   └── ${domain}/                      conversion / identity / job / note / storage / usage / workspace
│       ├── ${aggregate}.ts             note.ts / noteRevision.ts, user.ts / identity.ts / session.ts / authToken.ts
│       ├── valueObject.ts
│       ├── events.ts
│       ├── errorCode.ts
│       ├── ports/${port}.ts            noteRepository.ts, identityUniqueDirectory.ts, …
│       └── services/${policy}.ts       noteAccessPolicy.ts, identityPolicy.ts, loginThrottlePolicy.ts, …
├── application/
│   ├── di/
│   │   ├── types.ts                    AppConfig, SharedDeps, RequestContainer, WorkerContainer + the read views
│   │   ├── containerStore.ts           installContainerStore / getInstalledStore / getContainer
│   │   ├── memoryRuntime.ts            composition root of the in-memory backend (spec/adr/024)
│   │   ├── serverNode.ts               Node entry wiring: env → runtime options → containers
│   │   └── env.ts
│   ├── ports/                          clock, idGenerator, logger, outboxRepository, idempotencyStore,
│   │                                   appliedOperationStore, objectStorage, mailSender, scope* …
│   ├── errors.ts                       NotFound / Conflict / Unauthorized / Forbidden / Validation / SystemError
│   ├── events/buildDecoder.ts
│   ├── execution/
│   │   ├── unitOfWork.ts               the two UoW planes and their contexts (spec/adr/023)
│   │   └── eventId.ts                  mintEventIdFor — deterministic ids for continuation requests
│   ├── scope.ts                        ScopeKey (`user:{id}` / `workspace:{id}`)
│   ├── types.ts                        ServiceArgs<T>
│   ├── cleanup/participants.ts         the participants this deployment declares (spec/adr/039)
│   ├── workers/
│   │   ├── eventRelayWorker.ts         processOutboxEvents + the decoder registry
│   │   ├── subscribers.ts              the single event → consumer registry
│   │   ├── scopeTaskRunner.ts
│   │   └── outboxPrune.ts
│   └── ${domain}/                      identity / note / storage / usage
│       ├── view.ts                     DTO projections for the presentation layer
│       ├── eventDecoders.ts            outbox row → DomainEvent rehydration (lives here: it needs SystemError)
│       ├── ${usecase}.ts
│       └── __tests__/
├── adapters/
│   ├── memory/                         the reference backend (spec/adr/024) — not a test fake
│   │   ├── store.ts                    MemoryBackend, MemoryTransactionController, MemTable (undo log)
│   │   ├── support.ts                  createOccRepository, optimisticLockFailure / duplicateKey, deleteExpiredPage
│   │   ├── globalUnitOfWork.ts         createMemoryGlobalUnitOfWorkProvider
│   │   ├── scopeUnitOfWork.ts          createMemoryScopeUnitOfWorkProvider
│   │   ├── repositories/${port}.ts
│   │   └── passwordHasher.ts, secureTokenGenerator.ts, shareTokenProtector.ts, objectStorage.ts, …
│   ├── node/                           inProcessRelayTrigger, inMemoryQueueDispatcher
│   ├── oauth/                          Google / dev sign-in IdP clients + PKCE
│   └── conformance/                    shared port-contract suites (spec/adr/026)
├── lib/error.ts                        CodedError base + SerializedErrorBase / FieldErrors / SerializableError
│                                       (structure only; the union is assembled in presentation)
└── config.ts                           static site metadata

apps/web/app/presentation/              the framework-facing boundary
├── errorResponse.ts                    SerializedError union, serializeError, redactForClient, httpStatusFor, AppServerError
├── errorResponseMiddleware.ts          wraps validator + handler on every server function
├── validator.ts                        validateInput(schema) — transport-boundary shape check
├── serverAction.ts                     loadServerDeps / serverData
├── serverFragment.tsx                  renderServerFragment — hides errors thrown mid-RSC-stream (spec/adr/031)
├── session.ts, auth.ts, deletionTicket.ts, oauthState*.ts
└── errorDisplay.ts                     displayError, sanitizeRouteError
```

## Domain Layer

### Value Object

```ts
declare const noteIdBrand: unique symbol;
export type NoteId = string & { readonly [noteIdBrand]: true };

export const NoteId = {
  create: (id: string): NoteId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(NoteErrorCode.InvalidId, "Invalid note id");
    }
    return trimmed as NoteId;
  },
};
```

Key points:

- `unique symbol` for nominal typing
- the factory is the only creation path
- invalid values throw `BusinessRuleError` (the Result type is not used). The code comes from the domain's own `errorCode.ts` union (`NoteErrorCode` / `IdentityErrorCode` / …), so a `catch` site sees a literal union rather than `string`
- **do not add `generate()`**. id generation goes through the `IdGenerator` port in the application layer
- domain treats the id as an "opaque non-empty string". The format (UUIDv7 here) is the responsibility of the `IdGenerator` implementation, which pairs `next` with `validate` so a row-based storage adapter can re-check the format at rehydration. Putting generation and validation behind the same port means that when you swap the generator, the validator switches over in pair automatically, letting you swap the format without touching the VO
- business thresholds (title length, excerpt length, retention windows) live as module constants next to the VO or in a domain service — never in a port contract, where the same number would be duplicated once per backend (spec/adr/044)
- when a cap is a character count, state the unit. `NoteTitle` / `Excerpt` / `NoteHeading` measure **UTF-16 code units** (`String.length`), and the truncating ones cut with `truncateWithoutSplittingPair` so a surrogate pair is never split (spec/adr/033). Byte caps (`NoteHtml`, `PlainTextContent`) measure UTF-8 bytes with a cheap `length * 3` pre-check

### Entity

```ts
export type ActiveNote = NoteBase & Readonly<{ lifecycle: "active" }>;
export type TrashedNote = NoteBase &
  Readonly<{ lifecycle: "trashed"; trashedAt: Date; purgeAfter: Date }>;
export type Note = ActiveNote | TrashedNote;

export const Note = {
  createBlank: (
    params: Readonly<{
      id: string;
      owner: NoteOwner;
      createdBy: UserId;
      title: string;
      projectionRevision: number;
    }>,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const note: ActiveNote = {
      lifecycle: "active",
      id: NoteId.create(params.id),
      /* …the rest of the fields, all built through their own VOs… */
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: note,
      eventDrafts: [
        NoteEvents.created(
          {
            noteId: note.id,
            owner: note.owner,
            createdBy: note.createdBy,
            sourceFileId: null,
            projectionRevision: params.projectionRevision,
          },
          now,
        ),
      ],
    };
  },
};
```

Key points:

- represent state with a discriminated union → invalid transitions become type errors. `Note` has two of them at once (`lifecycle`, plus `content` and `visibility` unions inside `NoteBase`); `User` uses `status: pending | active | deleting | deleted`
- as with `Note.createBlank`, **VO construction is concentrated in the entity factory** (the application layer passes `id` as a raw string)
- take `now: Date` and the required `id` as arguments (domain never calls `new Date()` or `uuidv7()`)
- state transitions return `WithEventDrafts<TEntity, TEvent>`, handling the entity together with its **identity-less drafts**. Assigning the `EventId` is the application layer's responsibility (`attachEventIds`)
- for operations with no successor entity, such as purge or identity removal, do not put a method on the domain; the usecase emits `NoteEvents.purged(...)` / `IdentityEvents.identityRemoved(...)` directly
- guard invariants **from both sides**. `makeUnlisted` / `makePublic` call `ensureReady` (a shared note needs a ready body) and `markConversionFailed` / `markAwaitingIntegration` call `ensurePrivate` (a shared note may not drop back to a non-ready body). One-sided guards leave the illegal pair reachable from the other direction
- rehydration is a separate factory (`Note.reconstruct` / `User.reconstruct`). It rebuilds through the same VOs and throws `RehydrationError` — never silently substitutes a default for a missing column — so adapters can translate "stored data we cannot turn back into a domain object" into `SystemError(DataIntegrityError)`

### Domain Event

```ts
export type NoteCreatedEvent = DomainEventBase<
  "note.created",
  Readonly<{
    noteId: NoteId;
    owner: NoteOwner;
    createdBy: UserId;
    sourceFileId: StoredFileId | null;
    projectionRevision: number;
  }>
>;

export type NoteEvent = NoteCreatedEvent | NoteTrashedEvent | /* … */ NotePurgedEvent;

export const NoteEvents = {
  created: (
    params: Readonly<{
      noteId: NoteId;
      owner: NoteOwner;
      createdBy: UserId;
      sourceFileId: StoredFileId | null;
      projectionRevision: number;
    }>,
    occurredAt: Date,
  ): EventDraft<NoteCreatedEvent> => ({
    type: "note.created",
    payload: params,
    occurredAt,
    aggregateId: params.noteId,
  }),

  contentUpdated: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NoteContentUpdatedEvent> => ({
    type: "note.contentUpdated",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),
};
```

Key points:

- the factory returns **identity-less drafts**. The `EventId` is minted **inside the UoW** via `idGenerator` (the usecase just calls `collectEvents(drafts)`)
- this removes `EventId` from domain-function arguments and concentrates the id-generation responsibility in the unit-of-work implementations
- `type` is namespaced by domain (`note.*`, `identity.user.*`, `identity.identity.*`, `storage.*`) because every domain's events share one outbox and one registry
- a single-field payload takes positional arguments; three or more take one `Readonly<{ … }>` params object, so call sites cannot transpose two ids of the same type
- domain holds only event types and factories; the decoder goes to the application layer (keeping the dependency direction inward)

#### Event Decoder (application layer)

Write the decoder declaratively with the `buildEventDecoder(type, schema, rehydrate)` helper. You only write the schema definition + brand reconstruction; the helper absorbs the shape assert / `SystemError` conversion / meta forwarding.

```ts
// packages/core/src/application/note/eventDecoders.ts
import { z } from "zod";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { buildEventDecoder } from "../events/buildDecoder";

const noteIdOnly = z.object({ noteId: z.string().min(1) }).strict();
type NoteIdOnly = z.infer<typeof noteIdOnly>;

const noteIdPayload = (parsed: NoteIdOnly) => ({
  noteId: NoteId.create(parsed.noteId),
});

export const noteEventDecoders = {
  "note.contentUpdated": buildEventDecoder<NoteContentUpdatedEvent, NoteIdOnly>(
    "note.contentUpdated",
    noteIdOnly,
    noteIdPayload,
  ),

  "note.conversionFailed": buildEventDecoder<
    NoteConversionFailedEvent,
    { noteId: string; reason: NoteFailureReason }
  >(
    "note.conversionFailed",
    z.object({ noteId: z.string().min(1), reason: failureReasonSchema }).strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      reason: parsed.reason,
    }),
  ),
} as const;
```

Key points:

- put the decoder in the **application layer**. Since it maps decode failures to `SystemError(DataIntegrityError)`, it depends on the application's error contract and therefore cannot live in the inward-facing domain
- when adding a domain, the only diff is "schema definition + brand reconstruction". The shape assert / error conversion logic is confined to `buildEventDecoder`
- the payload schema rejects extra fields with `z.object(...).strict()`
- branded types are reconstructed inside the `rehydrate` function via `NoteId.create(p.noteId)`
- exhaustiveness is enforced once, at the registry: `defaultEventDecoderRegistry` is checked with `satisfies DefaultEventDecoderRegistry`, a complete map derived from the `AllDomainEvents` union (see [Outbox Worker](#outbox-worker)). The per-domain maps themselves are plain `as const` objects
- on decode failure, throw `SystemError(DataIntegrityError)` (the relay worker catches it per-row and routes it to the log)

### Repository Port

The base contract including OCC is already consolidated in `TransactionalRepository<TEntity, TId>` (`packages/core/src/domain/common/transactionalRepository.ts`). Each aggregate's port extends it and only adds read-only queries:

```ts
export interface NoteRepository extends TransactionalRepository<Note, NoteId> {
  listByIds(ids: readonly NoteId[]): Promise<readonly Note[]>;
  listPurgeable(now: Date, limit: number): Promise<readonly TrashedNote[]>;
  countByOwner(owner: NoteOwner, lifecycle: NoteLifecycleFilter): Promise<number>;
  /**
   * Ordered `updatedAt DESC, id DESC`. The `id` tiebreak is what makes the
   * order total: offset paging over a partial order lets a row repeat on
   * one page and vanish from the next.
   */
  listByOwner(
    owner: NoteOwner,
    lifecycle: NoteLifecycleFilter,
    pagination: Pagination,
  ): Promise<PaginationResult<Note>>;
}
```

What `TransactionalRepository<TEntity>` provides:

```ts
interface TransactionalRepository<TEntity, TId = string> {
  insert(entity: TEntity): Promise<void>;
  findById(id: TId): Promise<Versioned<TEntity> | null>;
  save(entity: TEntity, expectedVersion: ExpectedVersion<TEntity>): Promise<void>;
  delete(id: TId, expectedVersion: ExpectedVersion<TEntity>): Promise<void>;
}

type Versioned<T> = { readonly entity: T; readonly expectedVersion: ExpectedVersion<T> };
type ExpectedVersion<T> = number & { readonly [brand]: T };  // phantom T
```

Bind `TId` to the branded `NoteId`, not the raw `string` default. The lookup key is then a value object: the usecase constructs it via `NoteId.create(input.noteId)` at its boundary — before the lookup — so the id-format invariant is checked in one place and is no longer duplicated against the transport-layer schema. This is the same "validate at value-object construction" rule the entity factory already follows; an id and an entity are separate concerns, so the id VO is built up front while the entity is what `findById` returns once existence is confirmed. Binding `TId` also makes a foreign id (a `UserId` passed to a `Note` repository) a type error.

OCC is enforced at the type level with the `ExpectedVersion<Note>` token:

- only `findById` is the legitimate token-issuing point (a single `as` cast inside the adapter)
- `save` / `delete` take the token as a required argument → "writing without reading" is a type error
- `insert` is exclusively for initial persistence. Since no version exists yet, no OCC token is needed
- read-only queries like `listByOwner` are defined separately on the concrete port

Thanks to the phantom `T`, `ExpectedVersion<Note>` and `ExpectedVersion<User>` are type-incompatible → **mixing up tokens between aggregates is a type error**. This severs the implicit connection of "the domain function bumps the version → the adapter recomputes `entity.version - 1`", giving a contract where the version observed at read time is carried straight through to the write.

The port's JSDoc is the **normative** statement of its contract — atomicity, saga interruption points, keyset continuation, lease expiry and reclamation, and the error contract (`ConflictError("OPTIMISTIC_LOCK_FAILURE")` / `SystemError(DatabaseError)` / …). An implementer must be able to reach the required behaviour by reading the interface alone; nothing may be specified only in the conformance suite (spec/adr/026).

When adding a new port to a transaction:

1. add one slot line to the context of the plane that owns it — `GlobalUnitOfWorkContext` for identity / directory / routing / control-plane state, `ScopeUnitOfWorkContext` for one scope object's data (`packages/core/src/application/execution/unitOfWork.ts`)
2. construct it in the matching memory provider (`adapters/memory/globalUnitOfWork.ts` / `scopeUnitOfWork.ts`) and stuff it into the context
3. add a conformance suite for it and register the port on `ConformanceBackend` (see [Port Conformance](#port-conformance))

```ts
export interface ScopeUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly noteRepository: NoteRepository;
  readonly noteRevisionRepository: NoteRevisionRepository;
  readonly cleanupAdmission: ScopeCleanupAdmissionStore;
  readonly tagRepository: TagRepository;          // ← added
}
```

## Application Layer

### Usecase

Global plane — the identity aggregates, the uniqueness directory, and the control-plane stores:

```ts
export async function removeIdentity({
  container,
  input,
}: ServiceArgs<RemoveIdentityInput>): Promise<RemoveIdentityView> {
  const { clock, globalUnitOfWorkProvider } = container;
  const userId = UserId.create(input.userId);
  const identityId = IdentityId.create(input.identityId);
  const operationId = removalOperationId(identityId);
  const now = clock.now();

  await globalUnitOfWorkProvider.run(async (ctx) => {
    const identities = await ctx.identityRepository.listByUserId(userId);
    const target = identities.find((identity) => identity.id === identityId);
    if (target === undefined) throw new NotFoundError("IDENTITY_NOT_FOUND", "…");
    IdentityPolicy.ensureRemovable(identities, identityId);

    const versioned = await ctx.identityRepository.findById(identityId);
    if (versioned === null) throw new ConflictError("OPTIMISTIC_LOCK_FAILURE", "…");

    await ctx.identityRepository.delete(identityId, versioned.expectedVersion);
    await ctx.identityRemovalReceiptStore.record({ operationId, identityId, userId, /* … */ });
    ctx.collectEvents([
      IdentityEvents.identityRemoved({ identityId, userId, /* … */ operationId }, now),
    ]);
  });

  return {};
}
```

Scope plane — `run` takes the `ScopeKey` and the context exposes only that scope's repositories:

```ts
export async function createBlankNote({
  container,
  input,
}: ServiceArgs<CreateBlankNoteInput>): Promise<CreatedNoteView> {
  const { clock, idGenerator, noteRouteStore, scopeUnitOfWorkProvider } = container;
  const userId = UserId.create(input.userId);
  const owner = resolveOwner(input);
  const scope = scopeOf(owner);
  const rawTitle = input.title ?? "";
  // Validate before reserving the route, so an invalid title never
  // creates saga state.
  NoteTitle.manual(rawTitle);

  const now = clock.now();
  const noteId = NoteId.create(idGenerator.next());
  const operationId = idGenerator.next();

  // 1. reserve the global route
  await noteRouteStore.reserveCreate({
    noteId,
    scope,
    createdBy: userId,
    operationId,
    expiresAt: new Date(now.getTime() + CREATE_RESERVATION_TTL_MS),
  });

  // 2. commit in the scope object (a failure abandons the reservation)
  const note = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.cleanupAdmission.assertWritable();
    await ctx.cleanupAdmission.assertActorWritable(userId);
    const projectionRevision = await ctx.noteProjectionRevisionStore.bump(noteId);
    const created = Note.createBlank(
      { id: noteId, owner, createdBy: userId, title: rawTitle, projectionRevision },
      now,
    );
    await ctx.noteRepository.insert(created.entity);
    ctx.collectEvents(created.eventDrafts);
    return created.entity;
  });

  // 3. activate the route
  await noteRouteStore.activateCreate({ noteId, operationId });

  return { noteId: note.id, title: note.title.value, /* … */ };
}
```

Key points:

- resolve `now` / `id` at the top of the usecase. The `EventId` is minted **by the UoW inside `collectEvents`**, so the usecase doesn't have to care
- there are 4 VO-construction sites: the entity factory, the lookup-key construction at the top of a mutate/delete usecase (`NoteId.create(input.noteId)`), adapter rehydration, and the event decoder
- domain functions return identity-less drafts, and you just pass them straight through with `collectEvents(drafts)`. No explicit type arguments needed
- ride the Outbox pattern with `collectEvents` (flushed in the same tx)
- **never nest `run`** — not a global UoW inside a global UoW, not one plane inside the other. A cross-plane operation is written as a saga (reserve → commit → activate), not as one transaction, and shared transactional procedures are written as functions **receiving the context** rather than opening their own `run` (spec/adr/023)
- writes that the spec deliberately places outside a transaction — the uniqueness reservation saga, the note-route saga, the atomic login-attempt counter, the OAuth flow state's `take` — reach the usecase as full ports on the container instead of through a context
- the return value is a DTO (projected by a helper in `view.ts`). Type its fields as primitives, never branded VOs — brands widen to their primitive for free, so projection stays cast-free; the inbound direction is the VO `create()` above, also not a cast

There is intentionally no generic utility for OCC retry. `ConflictError` propagates straight to the caller, and only the usecases that need it build their own retry individually — `createBlankNote` retries `activateCreate` exactly once after a lost response, because the same operation id converges an already-active route.

### Container Wiring

Provide the container as **two independent types, one per scope**. Mix in `SharedDeps` (`clock` / `idGenerator` / `logger`) by intersection, and have each scope hold only the fields that are needed in that scope alone.

```ts
export type SharedDeps = Readonly<{
  clock: Clock;
  idGenerator: IdGenerator;
  logger: Logger;
}>;

// Request path: usecases (mutations go through one of the UoW providers) and
// SSR head/meta via `config`. Carries neither `outboxRepository` nor
// `idempotencyStore` — those are worker concerns.
export type RequestContainer = SharedDeps &
  Readonly<{
    config: AppConfig;
    globalUnitOfWorkProvider: GlobalUnitOfWorkProvider;
    scopeUnitOfWorkProvider: ScopeUnitOfWorkProvider;
    noteRouteStore: NoteRouteStore;
    identityUniqueDirectory: IdentityUniqueDirectory;
    userReader: UserReader;
    noteReaderFor: (scope: ScopeKey) => NoteReader;
    /* … mailSender, passwordHasher, objectStorage, key rings … */
  }>;

// Worker path: relay, consumer, pruner, DLQ, scope-task runner. Carries
// neither `config` nor a request-scoped anything.
export type WorkerContainer = SharedDeps &
  Readonly<{
    globalUnitOfWorkProvider: GlobalUnitOfWorkProvider;
    scopeUnitOfWorkProvider: ScopeUnitOfWorkProvider;
    outboxRepository: OutboxRepository;
    idempotencyStore: IdempotencyStore;
    scopeTaskQueue: ScopeTaskQueue;
    authStateSweeps: Readonly<Record<AuthStateTable, ExpirySweep>>;
    /* … */
  }>;
```

Read-only access is published as a `Pick` of the repository, which is what makes "mutations only inside a unit of work" a type-level rule rather than a convention:

```ts
export type UserReader = Pick<UserRepository, "findById">;
export type NoteReader = Pick<NoteRepository, "findById" | "listByOwner" | "countByOwner">;
```

`createMemoryRuntime(options)` (`application/di/memoryRuntime.ts`) is the composition root: one `MemoryBackend` shared by every adapter of the process, plus `createRequestContainer(config)` / `createWorkerContainer()`. `application/di/serverNode.ts` wraps it for the Node entry (env schema → runtime options → process-wide singleton), and `application/di/containerStore.ts` publishes the request-scoped container to framework code through a `globalThis` slot that SSR and RSC share.

Two wiring rules are easy to get wrong:

- pass the same `idGenerator` instance to the runtime that the containers expose. The UoW providers mint `EventId` with it when `collectEvents` flushes drafts to the outbox, so swapping in a fake for tests stays a single-point change
- the deployment's declared cleanup participants (`application/cleanup/participants.ts`) are handed to the stores by the composition root. The stores never assume a participant exists — a completion gate waits for **what was declared**, not for the whole enum (spec/adr/039)

The test harness flattens both scopes into a single fat shape so a test can invoke a usecase and then drive the worker pipeline in one place (see `docs/test.md`). Production code never holds that intersection; it always receives either `RequestContainer` or `WorkerContainer`.

## Adapter Layer

`adapters/memory/` is a regular backend, not a test fake: it is wired by the production DI path (`pnpm dev` runs on it) and it is held to the shared conformance suites any other backend must pass (spec/adr/024). The second backend — Cloudflare Durable Objects + D1 — implements the same ports and imports the same suites.

Adapters are grouped by provider, not by layer. Alongside `memory/` there are two small groups: `adapters/node/` holds the process-local transport pieces — `createInProcessRelayTrigger` (a `kick()` that defers one relay tick via `setImmediate`, collapsing concurrent kicks and draining on `stop()`) and `createInMemoryQueueDispatcher` (the `ack` / `retry` / throw contract of a hosted queue, expressed as an `EventDispatcher`) — and `adapters/oauth/` holds the sign-in IdP clients (Google, plus the dev provider) behind `SignInOAuthClient`. Cryptographic and Intl adapters (password hasher, secure token generator, share-token protector, time-zone resolver) currently live under `memory/` because splitting them out while a single backend exists would buy nothing but import paths.

### Repository (OCC implementation)

Every OCC repository is built from one shared factory, so the version check exists in a single place:

```ts
export function createOccRepository<TEntity extends { id: TId; version: Version }, TId extends string>(
  tableName: string,
  table: MemTable<TEntity>,
): TransactionalRepository<TEntity, TId> {
  const checkVersion = (id: TId, expectedVersion: ExpectedVersion<TEntity>): void => {
    const stored = table.get(id);
    if (stored === undefined || (stored.version as number) !== expectedVersion) {
      throw optimisticLockFailure(tableName, id);   // ConflictError("OPTIMISTIC_LOCK_FAILURE")
    }
  };
  return {
    async insert(entity) {
      if (table.has(entity.id)) throw duplicateKey(tableName, entity.id);  // SystemError(DatabaseError)
      table.set(entity.id, clone(entity));
    },
    async findById(id) {
      const stored = table.get(id);
      if (stored === undefined) return null;
      // The only legitimate minting site of the version token.
      return {
        entity: clone(stored),
        expectedVersion: stored.version as number as ExpectedVersion<TEntity>,
      };
    },
    async save(entity, expectedVersion) { checkVersion(entity.id, expectedVersion); table.set(entity.id, clone(entity)); },
    async delete(id, expectedVersion) { checkVersion(id, expectedVersion); table.delete(id); },
  };
}
```

A concrete repository spreads the base and adds only its read queries (`adapters/memory/repositories/noteRepository.ts`).

Key points:

- a version mismatch → `ConflictError("OPTIMISTIC_LOCK_FAILURE")`; a duplicate primary key → `SystemError(DatabaseError)`
- entities are cloned on both read and write so callers never alias the stored snapshot. Rows are replaced with a **new object** rather than mutated in place — that is what makes the undo log below sufficient for rollback
- driver-specific failures are translated inside the adapter, and transient ones are retried there. Application code never sees a provider-native error (the memory backend has no driver, so it only has to honour the error contract; a row-based backend owns both halves)
- do not use upsert semantics for `save` (it would hide lost updates)

### Unit of Work

`adapters/memory/{global,scope}UnitOfWork.ts` implement the two providers of `application/execution/unitOfWork.ts`:

1. `backend.transactions.run(...)` opens a transaction carried in an `AsyncLocalStorage` context
2. build the plane's repositories over the same backend (or the same `ScopeStore`, for the scope plane) and stuff them into the context
3. pass `fn` a context whose `collectEvents` buffers drafts and mints each `EventId` immediately
4. after `fn` resolves, flush the buffered events through `outboxRepository.save(...)` **inside the same transaction**
5. on a successful commit only, kick the relay trigger (and, for a scope commit that stored a continuation, the scope-task trigger)

Every table mutation issued from inside that async context records an undo entry, so a throw rolls back exactly this transaction's own writes in reverse order. Writes issued from other async contexts — the ports the spec puts outside any UoW — apply directly and survive a concurrent rollback. Transactions are serialized through a promise-chain mutex, approximating the single-writer isolation of the real backends, and a nested `run` is rejected outright (spec/adr/024).

The two planes differ in exactly one place: `GlobalUnitOfWorkProvider.run(fn)` takes only the callback, while `ScopeUnitOfWorkProvider.run(scope, fn)` requires a `ScopeKey` and hands back a context bound to that one scope object.

### Port Conformance

`adapters/conformance/` holds the contract of every port **in executable form** (spec/adr/026). A suite is a parameterized `describeXxxContract(backendName, makeBackend)`; a backend implements the `ConformanceBackend` factory once and runs every suite in a single file:

```ts
// packages/core/src/adapters/memory/__tests__/conformance.test.ts
describeUnitOfWorkContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityUniqueDirectoryContract(BACKEND, makeMemoryConformanceBackend);
// …one line per port
```

Key points:

- the suite asserts **observable results only** — both commits land, an intermediate state is not observable from the other side, the relay is kicked exactly once. Ordering and the means of isolation (mutex, batch flush, optimistic control) stay out, so a correct backend with different mechanics still passes
- name each case after the inventory ids it covers (`ADP-note-008/009: insert then findById round-trips with a version token`) so `spec/inventory/adapter.md` maps onto executed cases
- suites always take a **fresh** backend per test from the factory; implementations must not share state across factory calls
- a backend must make the UoW boundary and the relay kick observable (`relayKickCount()`), because those are the contracts that break most destructively when a backend is swapped

## Outbox Worker

```ts
import { processOutboxEvents } from "@repo/core/application/workers/eventRelayWorker";
import { dispatchDomainEvent } from "@repo/core/application/workers/subscribers";
import { createInMemoryQueueDispatcher } from "@repo/core/adapters/node/inMemoryQueueDispatcher";

const dispatch = createInMemoryQueueDispatcher({
  handler: async (event) => dispatchDomainEvent(event, workerContainer),
});

await processOutboxEvents(container, dispatch, { batchSize: 100 });
```

`EventDispatcher` receives the **whole decoded batch** of one relay tick and returns a per-event outcome (`{ kind: "success" | "failure", id }`). The batched shape lets a hosted-queue producer collapse N sends into one call, while an in-process dispatcher still reports per-event failures so one bad row cannot poison the rest of the batch. Outcomes may come back in any order; a row whose id is missing from the outcomes is treated as a failure, so every claimed row reaches a terminal disposition within the tick.

Routing lives in exactly one place: `application/workers/subscribers.ts`. A consumer role never holds its own `switch` — it calls `dispatchDomainEvent`, which looks the event type up in the registry. Several subscribers may share an event type and run in registration order.

### Delivery contract (pitfalls the consumer implementation must guard against)

As stated in the CLAUDE.md key concepts, the Outbox operates with **at-least-once delivery / no ordering**. Write the consumer on that premise. The "why" of the principle is in CLAUDE.md; here we expand on "what the implementation must guard against".

- **At-least-once (the same event arrives two or more times)** — the relay worker operates in the order "dispatch succeeds → mark the outbox row processed". If dispatch goes through but the process dies just before `finalize`, the same event is re-dispatched in the next round. Write the consumer so that **processing the same event N times produces the same result**.
  - Decide by the **commutativity of the effect, not by the subscriber's name** (spec/adr/045). A delete or an overwrite reaches the same terminal state on a re-run: skip the store and state the idempotence basis in that usecase's JSDoc. Only non-commutative effects (increments, aggregation) need duplicate suppression. No subscriber routes through `IdempotencyStore` today, and each one documents why.
  - Two stores exist because the **key means two different things**. `IdempotencyStore.markProcessed(consumer, eventId)` guards "one delivery of one event" on the global plane; `AppliedOperationStore.markApplied({ operationId, commandKey })` guards "one command of one operation" inside a scope. Neither is generalized into the other — that would loosen both JSDoc promises to "it depends".
  - **The record must share the unit of work of the effect it guards.** A `markProcessed` call in the dispatch loop would commit a record with no effect attached and break the contract, which is exactly why the Node consumer's dispatcher does not make one. A subscriber that touches an external resource (object storage) therefore cannot use the store at all and must be intrinsically idempotent instead.
- **No ordering (zero ordering guarantee)** — each row is rescheduled individually based on its `nextAttemptAt` (exponential backoff, 30s base, 1h cap) and `attempts`, so an ordering where `note.trashed` arrives before `note.created` happens routinely. Don't write consumer-side logic that assumes a state transition like "if I see `purged`, I must have seen `created`". If you need order, either **read the aggregate's current state before deciding**, or make the event self-contained by putting all the required state into the payload — which is why `note.purged` carries `owner` / `sourceFileId` / `routeVersion` rather than expecting the consumer to look them up after the row is gone.
- **Continuation requests ride the same transport** — work that no single turn can finish (account-deletion manifest build, dispatch, compaction, auth-residue cleanup) is continued by an application-level event stored in the transaction of the turn it follows (spec/adr/040). Their ids are **derived from a `continuationKey`** built from operation + phase + cursor rather than minted, so a replay after a lost commit response writes the *same* outbox row instead of forking the chain in two (`application/execution/eventId.ts`, spec/adr/041). `OutboxRepository.save` skips an id it already stores and leaves that row untouched, which is what makes the derivation safe. Two distinct events must therefore never share an id, and the retention window has to outlive the replay window.
- **Quarantine (isolating poison rows)** — a row whose `attempts` reaches `maxAttempts` (default 2) gets `failedAt` set and is quarantined. `claimPending` filters it out, so a poison row doesn't block the hot path. To re-kick, clear `failedAt` / `nextAttemptAt` and reset `attempts` — an operator action by design, which is also why `pruneOutbox` never touches quarantined rows. Decode failures (payload schema mismatch) ride the same retry path: after fixing the schema, re-kick and the row is re-dispatched. On a runtime whose consumer transport redelivers on its own, the user-visible attempt count is the **product** of the relay's `maxAttempts` and the transport's redelivery budget — keep both small. The Node runner's in-process dispatcher does not redeliver, so today the relay's budget is the whole of it.
- **Multi-worker safety (claim/lease)** — `claimPending` atomically claims rows and makes them invisible to other workers for `leaseMs` (default 5 min). A crashed worker's rows become re-claimable once the lease lapses. Even with multiple workers running, the same row is not dispatched twice.

### Key points

- log decode / dispatch failures to the logger; `processOutboxEvents` owns `attempts++`, backoff and quarantine, so a dispatcher must **return** outcomes rather than throw (a throwing dispatcher is treated as a batch-wide failure)
- a single call drains up to `maxIterations` consecutive batches (default 10) and stops as soon as a batch yields zero successes, so a large backlog cannot monopolise one tick

After adding a new domain, export `<domain>EventDecoders` from `packages/core/src/application/${domain}/eventDecoders.ts` and add it to both the `AllDomainEvents` union and `defaultEventDecoderRegistry` in `eventRelayWorker.ts`:

```ts
export type AllDomainEvents =
  | IdentityEvent
  | IdentityContinuationEvent
  | NoteEvent
  | StorageEvent
  | TagEvent;                 // ← extend the union

export const defaultEventDecoderRegistry = {
  ...identityEventDecoders,
  ...noteEventDecoders,
  ...storageEventDecoders,
  ...tagEventDecoders,        // ← add the decoder
} satisfies DefaultEventDecoderRegistry;
```

`DefaultEventDecoderRegistry` is a complete map type derived from `AllDomainEvents`, and `satisfies` rejects, as a compile error, the case where you wrote only the decoder while forgetting to add the domain — and vice versa. `EventDecoderRegistry` (`Partial<DefaultEventDecoderRegistry>`) is the type for passing overrides in tests and the like, forbidding unknown event types at the syntax level. Continuation types get the same treatment one level up: `continuationSubscribers` is keyed by continuation type with a non-empty tuple per key, so forgetting to subscribe one is a compile error rather than a chain that silently stops.

### Outbox Prune

```ts
import { pruneOutbox, DEFAULT_OUTBOX_RETENTION_MS } from "@repo/core/application/workers/outboxPrune";

await pruneOutbox(container, { retentionMs: DEFAULT_OUTBOX_RETENTION_MS }); // 7 days
```

`retentionMs` is raw milliseconds. `pruneOutbox` uses `clock.now() - retentionMs` as the cutoff and calls `outboxRepository.pruneProcessed(cutoff)`, which deletes only rows already marked processed before it. Unprocessed rows — including quarantined ones — are left alone, so it is safe to run concurrently with the relay worker. Keep the retention window longer than the window in which a lost commit response may be replayed: deleting a row frees its id for reuse, and a derived continuation id could then write a second row.

## Error Design

| Layer | Error type | Location |
|---|---|---|
| Domain | `BusinessRuleError<NoteErrorCode>`, `RehydrationError` | `packages/core/src/domain/error.ts` |
| Application | `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `SystemError` | `packages/core/src/application/errors.ts` |
| Presentation | `AppServerError` | `apps/web/app/presentation/errorResponse.ts` |

Every error class extends the abstract base `CodedError<TCode extends string>` in `packages/core/src/lib/error.ts`. The base class owns the `code: TCode` field, a default `retryable: false` getter, and the abstract method `toSerialized()`. The base's return type is the structural `SerializedErrorBase & { kind: string }`, and each subclass narrows it via override to its own `kind`-tagged variant.

`code` is a plain string. The per-class enums are deliberately collapsed (the domain enum plus the `SerializedErrorKind` assembled in presentation cover the classification we need). `SystemErrorCode` is kept because it is used for the runtime `retryable` decision: `NetworkError` / `ExternalApiError` are retryable, `DatabaseError` / `DataIntegrityError` are not.

Distinguish the two system codes when writing an adapter. `DatabaseError` is "the storage layer threw" (connection dropped, lock timeout, a batch limit exceeded by the caller); `DataIntegrityError` is "stored data violates the shape we expect" (corrupt row, schema-skewed payload, a `RehydrationError` from an aggregate's `reconstruct`). They share `kind: "system"` for transport but route differently in logs — a flood of `DataIntegrityError` means a migration is broken, not the DB.

`BusinessRuleError<TCode extends string = never>` defaults to `never`. Allowing an unparameterized `BusinessRuleError` would widen `code` to `string` at catch time, so we force the throw side to pass the domain's literal union. `isBusinessRuleError(...)` narrows to `BusinessRuleError<string>`.

Each error class declares its own `Serialized*Error` variant in the same file (`SerializedBusinessError` in domain, `SerializedNotFoundError` etc. in application) and returns that variant from `toSerialized()`. The presentation layer's `errorResponse.ts` gathers all variants and assembles the `SerializedError` discriminated union. Adding a new error type does not require touching presentation's `serializeError` (it just calls `toSerialized()` structurally). Only the `SerializedError` union and `SerializedErrorKind` need to be appended in the presentation layer, and `httpStatusFor` maps the `kind` — status mapping is presentation-only, never a field on the error.
