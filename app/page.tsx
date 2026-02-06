import VideoTest from "@/app/components/VideoTest";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)] py-6 px-4 sm:px-6 lg:px-8">
      <main className="max-w-[1400px] mx-auto">
        <VideoTest />
      </main>
    </div>
  );
}