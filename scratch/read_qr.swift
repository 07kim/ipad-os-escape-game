import Foundation
import CoreImage

guard CommandLine.arguments.count > 1 else {
    print("Usage: swift read_qr.swift <image_path>")
    exit(1)
}

let imagePath = CommandLine.arguments[1]
guard let image = CIImage(contentsOf: URL(fileURLWithPath: imagePath)) else {
    print("Failed to load image at \(imagePath)")
    exit(1)
}

let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
let features = detector?.features(in: image) as? [CIQRCodeFeature] ?? []

print("Found \(features.count) QR codes:")
for (index, feature) in features.enumerated() {
    if let message = feature.messageString {
        print("[\(index + 1)] Message: '\(message)' at bounds: \(feature.bounds)")
    }
}
