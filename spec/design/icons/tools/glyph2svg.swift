import CoreText
import CoreGraphics
import Foundation

// argv: <text> <postscriptFontName> <emSize>
let args = CommandLine.arguments
let text = args.count > 1 ? args[1] : "hollow"
let fontName = args.count > 2 ? args[2] : "AvenirNext-Regular"
let emSize: CGFloat = args.count > 3 ? CGFloat(Double(args[3]) ?? 1000) : 1000

let font = CTFontCreateWithName(fontName as CFString, emSize, nil)
let fullName = (CTFontCopyFullName(font) as String)
FileHandle.standardError.write("resolved font: \(fullName)\n".data(using: .utf8)!)

let attr = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
let line = CTLineCreateWithAttributedString(attr)

let combined = CGMutablePath()
let runs = CTLineGetGlyphRuns(line) as! [CTRun]
for run in runs {
    let n = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: n)
    var pos = [CGPoint](repeating: .zero, count: n)
    CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
    CTRunGetPositions(run, CFRange(location: 0, length: n), &pos)
    let runAttrs = CTRunGetAttributes(run) as NSDictionary
    let runFont = runAttrs[kCTFontAttributeName as String] as! CTFont
    for i in 0..<n {
        guard let gp = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
        var t = CGAffineTransform(translationX: pos[i].x, y: pos[i].y)
        combined.addPath(gp, transform: t)
    }
}

let bb = combined.boundingBoxOfPath
let minX = bb.minX, maxY = bb.maxY
func fx(_ x: CGFloat) -> String { String(format: "%.2f", x - minX) }
func fy(_ y: CGFloat) -> String { String(format: "%.2f", maxY - y) }   // y-up → y-down

var d = ""
combined.applyWithBlock { ptr in
    let e = ptr.pointee
    switch e.type {
    case .moveToPoint:
        let p = e.points[0]; d += "M\(fx(p.x)) \(fy(p.y))"
    case .addLineToPoint:
        let p = e.points[0]; d += "L\(fx(p.x)) \(fy(p.y))"
    case .addQuadCurveToPoint:
        let c = e.points[0], p = e.points[1]
        d += "Q\(fx(c.x)) \(fy(c.y)) \(fx(p.x)) \(fy(p.y))"
    case .addCurveToPoint:
        let c1 = e.points[0], c2 = e.points[1], p = e.points[2]
        d += "C\(fx(c1.x)) \(fy(c1.y)) \(fx(c2.x)) \(fy(c2.y)) \(fx(p.x)) \(fy(p.y))"
    case .closeSubpath:
        d += "Z"
    @unknown default: break
    }
}

print("W=\(String(format: "%.2f", bb.width))")
print("H=\(String(format: "%.2f", bb.height))")
print("PATH=\(d)")
