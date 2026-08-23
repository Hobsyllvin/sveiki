import { notFound } from "next/navigation";
import { loadLesson, loadAudioManifest, langOf, allLessonIds } from "@/lib/content/load";
import { buildPlaylist } from "@/lib/audio/playlist";
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
  const lang = langOf(lessonId);
  const playlist = buildPlaylist(lesson, loadAudioManifest(lang), lang);
  return <LessonView lesson={lesson} playlist={playlist} />;
}
