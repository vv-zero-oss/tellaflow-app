import AVFoundation
import Foundation

// mic-mode: Query Apple microphone mode and open system picker.
//
// Usage:
//   mic-mode status    — Print "active:<mode> preferred:<mode>"
//   mic-mode picker    — Open the system microphone mode picker (Control Center)
//
// Modes: standard, voice-isolation, wide-spectrum, unknown
// Requires macOS 14.0+. On older macOS, prints "unsupported" and exits 0.

func main() {
    let args = CommandLine.arguments
    let command = args.count > 1 ? args[1] : "status"

    guard #available(macOS 14.0, *) else {
        print("unsupported")
        exit(0)
    }

    switch command {
    case "status":
        printStatus()
    case "picker":
        openPicker()
    default:
        print("usage: mic-mode [status|picker]")
        exit(1)
    }
}

@available(macOS 14.0, *)
func modeString(_ mode: AVCaptureDevice.MicrophoneMode) -> String {
    switch mode {
    case .standard: return "standard"
    case .voiceIsolation: return "voice-isolation"
    case .wideSpectrum: return "wide-spectrum"
    @unknown default: return "unknown"
    }
}

@available(macOS 14.0, *)
func printStatus() {
    let active = AVCaptureDevice.activeMicrophoneMode
    let preferred = AVCaptureDevice.preferredMicrophoneMode
    print("active:\(modeString(active)) preferred:\(modeString(preferred))")
}

@available(macOS 14.0, *)
func openPicker() {
    AVCaptureDevice.showSystemUserInterface(.microphoneModes)
    // Give the UI a moment to appear before exiting
    Thread.sleep(forTimeInterval: 0.3)
    print("opened")
}

main()
