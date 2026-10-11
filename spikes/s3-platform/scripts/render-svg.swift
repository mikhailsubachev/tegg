// Renders an SVG to a square RGBA PNG with AppKit (macOS 14+ reads SVG natively). Usage: render-svg in.svg out.png size
import AppKit
let a = CommandLine.arguments
guard a.count == 4, let img = NSImage(contentsOfFile: a[1]), let n = Int(a[3]) else { fatalError("usage: render-svg in.svg out.png size") }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
img.draw(in: NSRect(x: 0, y: 0, width: n, height: n))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
