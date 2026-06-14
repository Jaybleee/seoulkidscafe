import Foundation
import PDFKit
import AppKit

if CommandLine.arguments.count < 4 {
    fputs("Usage: swift tools/render_pdf_pages.swift input.pdf output_dir page_numbers...\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDir = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

guard let document = PDFDocument(url: inputURL) else {
    fputs("Failed to open PDF: \(inputURL.path)\n", stderr)
    exit(1)
}

for pageArgument in CommandLine.arguments.dropFirst(3) {
    guard let pageNumber = Int(pageArgument), pageNumber >= 1, pageNumber <= document.pageCount else {
        fputs("Skipping invalid page: \(pageArgument)\n", stderr)
        continue
    }

    guard let page = document.page(at: pageNumber - 1) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 3.0
    let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
    let image = NSImage(size: size)

    image.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    guard let context = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        continue
    }
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()
    image.unlockFocus()

    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let data = bitmap.representation(using: .png, properties: [:])
    else { continue }

    let outputURL = outputDir.appendingPathComponent(String(format: "page_%02d.png", pageNumber))
    try data.write(to: outputURL)
    print(outputURL.path)
}
