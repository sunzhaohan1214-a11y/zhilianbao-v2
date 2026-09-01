"use client";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f5f7fa", color: "#101828", fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "100%", maxWidth: 420, boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 24, background: "#fff", padding: 32, textAlign: "center" }}>
            <p style={{ margin: 0, color: "#1769ff", fontSize: 14, fontWeight: 600 }}>智链宝</p>
            <h1 style={{ margin: "8px 0 0", fontSize: 24 }}>系统暂时无法显示</h1>
            <p style={{ margin: "12px 0 0", color: "#475467", fontSize: 14, lineHeight: 1.7 }}>请稍后重试；重试不会重复提交业务操作。</p>
            <button onClick={() => retry()} style={{ minHeight: 44, marginTop: 24, border: 0, borderRadius: 12, background: "#1769ff", color: "white", padding: "0 18px", font: "inherit", fontWeight: 600, cursor: "pointer" }}>重新加载</button>
          </section>
        </main>
      </body>
    </html>
  );
}
