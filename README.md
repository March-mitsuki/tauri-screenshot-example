# 📸 Tauri Screenshot Tool

**[中文文档](./README.zh-CN.md)** | **[English Documentation](./README.md)**

A modern screenshot application built with **Tauri 2.0** + **React** + **xcap**, featuring excellent multi-monitor and cross-screen screenshot support.

Works on **Windows** and **MacOS** 

> **⚠️ Development Environment Note**  
> Screenshots may have a 1-2 second delay in development builds, which is normal behavior. In production builds, screenshot latency is significantly improved to 100-300ms (depending on the number of connected monitors).

## ✨ Features

- 🚀 **Global Hotkey Screenshots** - Capture screens anytime, anywhere
- 🖥️ **Multi-Monitor Support** - Perfect compatibility with multi-display setups
- 📐 **Cross-Screen Screenshots** - Support for screenshot areas spanning multiple monitors
- 🎨 **Customizable Tools** - Flexible screenshot tool configuration
- 💾 **Multiple Save Options** - Save to local files or copy to clipboard
- ✅ **Hight DPI Monitor Support** - Edit at monitor logical scale and save screenshot at physical scale.

## 📁 Core File Structure

```txt
.
├── index.html          # Main interface entry
├── overlay.html         # Screenshot overlay interface
├── vite.config.ts       # Multi-page Vite configuration
├── src/
│   └── overlay/
│       ├── index.tsx           # Screenshot content display component
│       └── clip-overlay.tsx     # User selection control component
└── src-tauri/
    └── lib.rs
```

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

## 🤔 Rambling

### Q: Why develop this tool?
**A:** Other projects needed screenshot functionality, but no existing tool provided good cross-screen support. So I decided to build my own. This project serves as a reference template that you can use for secondary development or directly.

### Q: Why not make it a plugin?
**A:** Just being lazy 😅. If any developers are interested, contributions to make this project plugin-ready are very welcome!

### Q: Why not use [tauri-plugin-screenshots](https://github.com/ayangweb/tauri-plugin-screenshots) directly?
**A:** While `tauri-plugin-screenshots` provides convenient JavaScript APIs, it doesn't support multi-monitor environments, and our project requires greater customizability and multi-screen support. Therefore, we chose to implement the underlying screenshot functionality directly based on `xcap`.


## 📄 License

MIT
