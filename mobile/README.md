## ⚠️ Native Module Compatibility Rules (Expo)

This project uses Expo (managed workflow). To keep builds stable, avoid adding native modules that require manual iOS configuration.

### ❌ Do NOT install:

- react-native-ios-context-menu  
  → Requires Swift + manual CocoaPods setup  
  → Breaks Expo prebuild and iOS build

- react-native-ios-utilities  
  → Causes RCT-Folly and native dependency conflicts

- @teovilla/react-native-web-maps  
  → Pulls outdated expo-location → causes duplicate native modules

- Any library that:
  - requires manual Podfile edits
  - requires `use_frameworks!`
  - is not Expo-compatible

---

### 🧠 Why?

Expo manages native code automatically. These libraries override or conflict with Expo’s generated configuration, causing:

- Pod install failures
- Duplicate native module errors
- iOS build crashes

---

### ✅ Use instead:

| Feature          | Recommended                         |
| ---------------- | ----------------------------------- |
| Context menus    | @gorhom/bottom-sheet / custom modal |
| Native utilities | expo-\* libraries                   |
| Maps             | react-native-maps (Expo supported)  |

---

### 🚨 Rule of thumb

If a library:

- mentions Swift / Objective-C setup
- requires Xcode steps

→ It is likely NOT safe for Expo.
