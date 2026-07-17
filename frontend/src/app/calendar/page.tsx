"use client";

import { useProfile } from "@/contexts/profile-context";
import { PostizMonthlyCalendar } from "@/components/schedule/postiz-monthly-calendar";
import { PageHeader } from "@/components/page-header";

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
    <div className="max-w-[1400px] mx-auto p-6">
      <PageHeader className="mb-6" title="Calendar" />
      <PostizMonthlyCalendar />
    </div>
  );
}
