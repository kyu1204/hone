// Starts app.py on a free port and waits until it answers; used by the examples test and handy for local runs.
export async function startRagServer(dir: string): Promise<{ url: string; stop: () => void }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = Bun.spawn(["python3", `${dir}/app.py`], { env: { ...process.env, PORT: String(port) }, stdout: "pipe", stderr: "inherit" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${url}/ask`, { method: "POST", body: "{}" });
      if (res.ok) return { url, stop: () => proc.kill() };
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  throw new Error("rag-python server did not start");
}

if (import.meta.main) {
  const s = await startRagServer(new URL(".", import.meta.url).pathname);
  console.log(`RAG_URL=${s.url}`);
}
