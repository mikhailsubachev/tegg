// L6 helper (docs/contracts/ms5-capture.md §11.1): "another app" that holds a global hotkey, for capture.md FR-CAP-05
// AC-5…AC-7 (D-71). Test code. Compiled with `swiftc -O holdhotkey.swift -o <tmp>/holdhotkey` by the suite's setup.
//
//   holdhotkey [space] [t]          register ⌃⌥Space and/or ⌃⌥T (default: space); print one line per key
//                                   (`registered space` or `taken space`); keep them until killed
//   holdhotkey --check [space] [t]  try to register, release, exit 0 if every key could be registered, else 1
//
// Registrations are exclusive (`kEventHotKeyExclusive`): a later exclusive registration of the same key by another
// process fails, which is how a conflict becomes visible (a non-exclusive registration would silently share the key;
// red-test point AP-509).
import Carbon
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
let check = args.contains("--check")
var keys = args.filter { $0 != "--check" }
if keys.isEmpty { keys = ["space"] }

let codes: [String: UInt32] = ["space": UInt32(kVK_Space), "t": UInt32(kVK_ANSI_T)]
let modifiers = UInt32(controlKey | optionKey)
var refs: [EventHotKeyRef?] = []
var allOk = true

for (i, key) in keys.enumerated() {
  guard let code = codes[key] else { print("unknown \(key)"); allOk = false; continue }
  var ref: EventHotKeyRef?
  let id = EventHotKeyID(signature: OSType(0x54454747), id: UInt32(i + 1)) // 'TEGG'
  let status = RegisterEventHotKey(code, modifiers, id, GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &ref)
  if status == noErr {
    print("registered \(key)")
    refs.append(ref)
  } else {
    print("taken \(key)")
    allOk = false
  }
}
fflush(stdout)

if check {
  for r in refs { if let r = r { UnregisterEventHotKey(r) } }
  exit(allOk ? 0 : 1)
}

signal(SIGTERM) { _ in exit(0) }
RunLoop.main.run()
