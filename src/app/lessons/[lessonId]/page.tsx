import { notFound } from "next/navigation";
import { loadLesson, loadTimings, audioSrc, allLessonIds } from "@/lib/content/load";
import LessonView from "@/components/LessonView";

interface Props {
  params: Promise<{ lessonId: string }>;
}

export async function generateStaticParams() {
  return allLessonIds().map((lessonId) => ({ lessonId }));
}

export default async function LessonPage({ params }: Props) {
  const { lessonId } = await params;
  const lesson = loadLesson(lessonId);
  if (!lesson) notFound();
  const timings = loadTimings(lessonId);
  return (
    <LessonView
      lesson={lesson}
      timings={timings}
      audioSrc={timings ? audioSrc(lessonId, timings) : null}
    />
  );
}
