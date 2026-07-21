"use client";

import { useProfile } from "@/contexts/profile-context";
import { PostizMonthlyCalendar } from "@/components/schedule/postiz-monthly-calendar";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";

export default function CalendarPage() {
  const { isLoading: profileLoading } = useProfile();

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader title="Calendar" />
      <PostizMonthlyCalendar />
    </PageShell>
  );
}
