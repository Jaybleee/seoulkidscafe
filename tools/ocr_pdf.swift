import Foundation
import PDFKit
import Vision
import AppKit

if CommandLine.arguments.count < 3 {
    fputs("Usage: swift tools/ocr_pdf.swift input.pdf output.txt\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let document = PDFDocument(url: inputURL) else {
    fputs("Failed to open PDF: \(inputURL.path)\n", stderr)
    exit(1)
}

let recognitionLanguages = ["ko-KR", "en-US"]
var allText: [String] = []

for pageIndex in 0..<document.pageCount {
    guard let page = document.page(at: pageIndex) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.0
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
        let cgImage = bitmap.cgImage
    else {
        continue
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = recognitionLanguages

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fputs("OCR failed on page \(pageIndex + 1): \(error)\n", stderr)
        continue
    }

    let lines = (request.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
    allText.append("\n\n=== PAGE \(pageIndex + 1) ===\n" + lines.joined(separator: "\n"))
}

try allText.joined(separator: "\n").write(to: outputURL, atomically: true, encoding: .utf8)
print("Wrote \(outputURL.path)")
