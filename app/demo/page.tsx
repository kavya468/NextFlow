import type { Metadata } from "next";
import Link from "next/link";
import { APP_UI } from "@/lib/ui-config";

const demo = APP_UI.demo;

export const metadata: Metadata = {
  title: `${APP_UI.name} — ${demo.title}`,
  description: demo.description,
};

export default function DemoPage() {
  return (
    <main className="demo-page">
      <div className="demo-shell">
        <header className="demo-header">
          <Link href="/dashboard" className="demo-brand">{APP_UI.name}</Link>
          <Link href="/dashboard" className="demo-studio-link">{demo.studioLabel}</Link>
        </header>
        <section aria-labelledby="demo-title">
          <h1 id="demo-title" className="demo-title">{demo.title}</h1>
          <p className="demo-description">{demo.description}</p>
          <video
            className="demo-video"
            aria-label={demo.videoLabel}
            aria-describedby="demo-note"
            controls
            playsInline
            preload={demo.preload}
            poster={demo.poster}
            width={demo.width}
            height={demo.height}
          >
            <source src={demo.src} type="video/mp4" />
            <track kind="captions" src={demo.captions} srcLang="en" label={demo.captionsLabel} />
            <a href={demo.src}>{demo.downloadLabel}</a>
          </video>
          <div className="demo-caption">
            <p id="demo-note">{demo.note}</p>
            <a href={demo.src} download>{demo.downloadLabel}</a>
          </div>
          <details className="demo-transcript">
            <summary>{demo.transcriptLabel}</summary>
            {demo.transcript.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </details>
        </section>
        <footer className="demo-credits">
          <a href={demo.creatorUrl}>{demo.creator}</a>
          <p>
            {demo.music.label}{" "}<a href={demo.music.url}>{demo.music.title}</a>{" "}
            {demo.music.artist}{" · "}<a href={demo.music.licenseUrl}>{demo.music.license}</a>
            {" · "}{demo.music.changes}
          </p>
        </footer>
      </div>
    </main>
  );
}
