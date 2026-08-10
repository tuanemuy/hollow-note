import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

// Both fragments require the session inside the handler (defense in
// depth: the route guard redirects, this returns 401). The promises are
// returned UNRESOLVED so the loaders forward them and the fragments
// stream in under their Suspense fallbacks. `renderServerFragment` is the
// redaction boundary for errors that reject mid-stream, after
// `errorResponseMiddleware` has already returned.

export const renderNoteList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ NoteList }, { requireSession }] = await Promise.all([
      import("@/components/note/NoteList"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      NoteList: renderServerFragment(() => NoteList({ userId: user.userId })),
    };
  });

const noteDetailInputSchema = z.object({
  noteId: z.string().min(1).max(128),
});

export const renderNoteDetail = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteDetailInputSchema))
  .handler(async ({ data }) => {
    const [{ NoteDetail }, { requireSession }] = await Promise.all([
      import("@/components/note/NoteDetail"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      NoteDetail: renderServerFragment(() =>
        NoteDetail({ noteId: data.noteId, userId: user.userId }),
      ),
    };
  });
