# Third-party notices

## deepseek-harness

Parts of Tether are ported from deepseek-harness (re-implemented against Tether's code, keeping their algorithms, constants and test cases). Each ported file says which package it came from:

- `compaction/compaction-tool-result-pruner` → `src/adapters/prune.ts`
- `guard/repeat-tool-reminder` → `src/adapters/repeatGuard.ts`
- `spill/spill-policy`, `spill/spill-local` → `src/codemode/spill.ts`
- `experimental/browser-use-playwright-mcp`, `experimental/browser-use-chrome-devtools-mcp` → `MCP_PRESETS` in `src/codemode/mcpServers.ts`

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
