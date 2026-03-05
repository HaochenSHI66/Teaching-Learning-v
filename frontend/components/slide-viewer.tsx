import { getAssetUrl, type Slide } from "@/lib/api";

type SlideViewerProps = {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
};

export function SlideViewer({ slides, currentIndex, onSelect }: SlideViewerProps) {
  const currentSlide = slides[currentIndex];

  if (!currentSlide) {
    return (
      <section className="h-full rounded-2xl bg-white/80 p-6 shadow-panel">
        <p className="text-sm text-slate-600">上传文档后会在这里显示 PPT 页面。</p>
      </section>
    );
  }

  return (
    <section className="grid h-full grid-cols-[112px_1fr] gap-4 rounded-2xl bg-white/80 p-4 shadow-panel">
      <aside className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        <ul className="space-y-2">
          {slides.map((slide, index) => (
            <li key={slide.id}>
              <button
                className={`w-full overflow-hidden rounded-lg border text-left transition ${
                  index === currentIndex
                    ? "border-accent ring-2 ring-accent/30"
                    : "border-slate-200 hover:border-slate-300"
                }`}
                onClick={() => onSelect(index)}
                type="button"
              >
                <img
                  alt={`Slide ${slide.page_num}`}
                  className="block h-auto w-full"
                  src={getAssetUrl(slide.thumbnail_url)}
                />
                <span className="block bg-white px-2 py-1 text-xs text-slate-500">#{slide.page_num}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-3">
        <header className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          <span>当前页：{currentSlide.page_num}</span>
          <span>
            {currentIndex + 1}/{slides.length}
          </span>
        </header>
        <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-2">
          <img
            alt={`Slide ${currentSlide.page_num}`}
            className="mx-auto h-auto max-w-full rounded-lg"
            src={getAssetUrl(currentSlide.image_url)}
          />
        </div>
      </div>
    </section>
  );
}
