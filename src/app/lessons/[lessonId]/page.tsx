import { notFound } from "next/navigation";
import { loadLesson, allLessonIds } from "@/lib/content/load";
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
  return <LessonView lesson={lesson} />;
}
