// A stand-in for src/stt/worker.ts over the same IPC protocol (no native module): it "hears" the number of samples it got.
// A dataRoot with "crash" in it exits before ready, like a native library that fails to load.
const cfg = JSON.parse(process.argv[2]);
if (cfg.dataRoot.includes('crash')) {
  process.stderr.write('dyld: Library not loaded: libonnxruntime.dylib\n');
  process.exit(3);
}
process.on('message', (m) => {
  if (m.pcm.byteLength % 2) return process.send({ id: m.id, error: 'Speech audio must be 16-bit PCM', input: true });
  if (m.pcm.byteLength === 4) return process.exit(9);
  process.send({ id: m.id, text: `heard ${m.pcm.byteLength / 2} samples`, audioSeconds: m.pcm.byteLength / 32000, inferenceSeconds: 0 });
});
process.on('disconnect', () => process.exit(0));
process.send({ ready: true });
