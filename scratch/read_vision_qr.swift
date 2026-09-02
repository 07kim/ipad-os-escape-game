import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(1) }
let path = CommandLine.arguments[1]
guard let nsImage = NSImage(contentsOfFile: path),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Cannot load image")
    exit(1)
}

let request = VNDetectBarcodesRequest { request, error in
    guard let results = request.results as? [VNBarcodeObservation] else {
        print("No barcode results")
        return
    }
    print("Vision found \(results.count) barcodes:")
    let sorted = results.sorted { (a, b) -> Bool in
        if abs(a.boundingBox.origin.y - b.boundingBox.origin.y) > 0.1 {
            return a.boundingBox.origin.y > b.boundingBox.origin.y
        }
        return a.boundingBox.origin.x < b.boundingBox.origin.x
    }
    for (i, bar) in sorted.enumerated() {
        print("[\(i+1)] Payload: '\(bar.payloadStringValue ?? "nil")'")
    }
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
