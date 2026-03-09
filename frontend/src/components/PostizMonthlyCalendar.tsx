"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { PostDetailModal } from "@/components/PostDetailModal";

/* ---------- Types ---------- */

export interface PostizPost {
  id: string;
  content: string;
  publish_date: string;
  state: "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT";
  release_url?: string;
  platform: string;
  platform_name: string;
  platform_picture?: string;
}

export interface ScheduleItem {
  id: string;
  clip_id: string;
  clip_name: string;
  thumbnail_path?: string;
  final_video_path?: string;
  scheduled_date: string;
  scheduled_at: string;
  status: string;
  postiz_post_id?: string;
  error_message?: string;
}

export interface CalendarData {
  postiz_posts: PostizPost[];
  schedule_items: ScheduleItem[];
  days: Record<string, { postiz_count: number; scheduled_count: number; published_count: number }>;
}

interface PostizMonthlyCalendarProps {
  /** Optional title override (default: "Postiz Calendar") */
  title?: string;
  /** Called after calendar data is fetched, so parent can access it */
  onDataLoaded?: (data: CalendarData) => void;
}

/* ---------- Constants ---------- */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------- Helpers ---------- */

function stateColor(state: string): string {
  switch (state) {
    case "PUBLISHED": return "bg-green-500/20 text-green-300 border-green-500/30";
    case "QUEUE": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "ERROR": return "bg-red-500/20 text-red-300 border-red-500/30";
    case "DRAFT": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function getMonthCalendarDays(year: number, month: number): { date: string; isCurrentMonth: boolean }[] {
  const days: { date: string; isCurrentMonth: boolean }[] = [];

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d.toISOString().split("T")[0], isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    days.push({ date: dt.toISOString().split("T")[0], isCurrentMonth: true });
  }

  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: d.toISOString().split("T")[0], isCurrentMonth: false });
    }
  }

  return days;
}

/* ---------- Component ---------- */

export function PostizMonthlyCalendar({ title = "Postiz Calendar", onDataLoaded }: PostizMonthlyCalendarProps) {
  // Store callback in ref to avoid re-fetch loops
  const onDataLoadedRef = useRef(onDataLoaded);
  onDataLoadedRef.current = onDataLoaded;

  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PostizPost | null>(null);

  const monthDays = useMemo(() => getMonthCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  const dateRange = useMemo(() => {
    if (monthDays.length === 0) return { start: "", end: "" };
    return {
      start: monthDays[0].date,
      end: monthDays[monthDays.length - 1].date,
    };
  }, [monthDays]);

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  const postsByDate = useMemo(() => {
    if (!calendarData) return {};
    const map: Record<string, PostizPost[]> = {};
    for (const post of calendarData.postiz_posts) {
      const date = post.publish_date.split("T")[0];
      if (!map[date]) map[date] = [];
      map[date].push(post);
    }
    return map;
  }, [calendarData]);

  const scheduleItemsByDate = useMemo(() => {
    if (!calendarData) return {};
    const map: Record<string, ScheduleItem[]> = {};
    for (const item of calendarData.schedule_items) {
      const date = item.scheduled_date.split("T")[0];
      if (!map[date]) map[date] = [];
      map[date].push(item);
    }
    return map;
  }, [calendarData]);

  const postToScheduleItem = useMemo(() => {
    if (!calendarData) return new Map<string, ScheduleItem>();
    const map = new Map<string, ScheduleItem>();
    for (const item of calendarData.schedule_items) {
      if (item.postiz_post_id) {
        map.set(item.postiz_post_id, item);
      }
    }
    return map;
  }, [calendarData]);

  const handlePostDeleted = useCallback((postId: string) => {
    setCalendarData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        postiz_posts: prev.postiz_posts.filter(p => p.id !== postId),
      };
    });
  }, []);

  /* ---------- Fetch ---------- */

  const fetchCalendar = useCallback(async () => {
    if (!dateRange.start) return;
    setLoadingCalendar(true);
    try {
      const res = await apiGet(
        `/schedule/calendar?start_date=${dateRange.start}&end_date=${dateRange.end}`
      );
      const data: CalendarData = await res.json();
      setCalendarData(data);
      onDataLoadedRef.current?.(data);
    } catch (err) {
      console.error("Failed to load calendar:", err);
    } finally {
      setLoadingCalendar(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  /* ---------- Navigation ---------- */

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(y => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(y => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  /* ---------- Weeks ---------- */

  const weeks = useMemo(() => {
    const result: typeof monthDays[] = [];
    for (let i = 0; i < monthDays.length; i += 7) {
      result.push(monthDays.slice(i, i + 7));
    }
    return result;
  }, [monthDays]);

  /* ---------- Render ---------- */

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="size-8" onClick={goToPrevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-sm font-semibold px-3 min-w-[160px] justify-center"
              onClick={goToToday}
            >
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Button>
            <Button variant="outline" size="icon" className="size-8" onClick={goToNextMonth}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={fetchCalendar} disabled={loadingCalendar} className="ml-2">
              <RefreshCw className={`size-3.5 mr-1.5 ${loadingCalendar ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadingCalendar && !calendarData ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border-t">
            {/* Weekday header */}
            <div className="grid grid-cols-7">
              {WEEKDAY_LABELS.map((day, i) => (
                <div
                  key={day}
                  className={`px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground ${
                    i < 6 ? "border-r" : ""
                  } border-b bg-muted/30`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7">
                {week.map(({ date: dateStr, isCurrentMonth }, dayIdx) => {
                  const isToday = dateStr === todayStr;
                  const dayNum = new Date(dateStr + "T00:00:00").getDate();
                  const posts = postsByDate[dateStr] || [];
                  const items = scheduleItemsByDate[dateStr] || [];
                  const totalItems = posts.length + items.length;

                  return (
                    <div
                      key={dateStr}
                      className={`min-h-[90px] flex flex-col ${
                        dayIdx < 6 ? "border-r" : ""
                      } ${weekIdx < weeks.length - 1 ? "border-b" : ""} ${
                        !isCurrentMonth ? "bg-muted/10" : ""
                      } ${isToday ? "bg-primary/5" : ""}`}
                    >
                      {/* Day number header */}
                      <div className="flex items-center justify-between px-1.5 py-1">
                        <span
                          className={`text-xs leading-none ${
                            isToday
                              ? "bg-primary text-primary-foreground rounded-full size-6 flex items-center justify-center font-bold"
                              : isCurrentMonth
                              ? "text-foreground font-medium"
                              : "text-muted-foreground/50"
                          }`}
                        >
                          {dayNum}
                        </span>
                        {totalItems > 0 && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                            {totalItems}
                          </Badge>
                        )}
                      </div>

                      {/* Posts & items in this day */}
                      <div className="flex-1 px-1 pb-1 space-y-0.5 overflow-y-auto">
                        {posts.map((post) => {
                          const timeStr = post.publish_date
                            ? new Date(post.publish_date).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })
                            : "";
                          return (
                            <div
                              key={post.id}
                              className={`rounded px-1 py-0.5 text-[10px] leading-tight border cursor-pointer hover:opacity-80 transition-opacity ${stateColor(post.state)}`}
                              title={`[${post.state}] ${post.platform_name}\n${timeStr}\n${stripHtml(post.content || "(no content)")}`}
                              onClick={() => setSelectedPost(post)}
                            >
                              <div className="flex items-center gap-1">
                                {post.platform_picture ? (
                                  <img src={post.platform_picture} alt="" className="size-3 rounded-full shrink-0" />
                                ) : null}
                                <span className="truncate font-medium">
                                  {timeStr && <span className="opacity-70 mr-0.5">{timeStr}</span>}
                                  {post.content ? stripHtml(post.content).slice(0, 20) : post.platform_name}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {items.map((item) => {
                          const timeStr = item.scheduled_at
                            ? new Date(item.scheduled_at).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })
                            : "";
                          const itemState =
                            item.status === "published" ? "PUBLISHED"
                              : item.status === "scheduled" ? "QUEUE"
                              : item.status === "failed" ? "ERROR"
                              : "DRAFT";
                          return (
                            <div
                              key={item.id}
                              className={`rounded px-1 py-0.5 text-[10px] leading-tight border ${
                                item.postiz_post_id ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"
                              } ${stateColor(itemState)}`}
                              title={`[${item.status}] ${item.clip_name}\n${timeStr}`}
                              onClick={() => {
                                if (item.postiz_post_id) {
                                  const linkedPost = calendarData?.postiz_posts.find(p => p.id === item.postiz_post_id);
                                  if (linkedPost) setSelectedPost(linkedPost);
                                }
                              }}
                            >
                              <div className="flex items-center gap-1">
                                {item.thumbnail_path ? (
                                  <img src={item.thumbnail_path} alt="" className="size-3 rounded shrink-0" />
                                ) : null}
                                <span className="truncate font-medium">
                                  {timeStr && <span className="opacity-70 mr-0.5">{timeStr}</span>}
                                  {item.clip_name}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <PostDetailModal
        post={selectedPost}
        scheduleItem={selectedPost ? postToScheduleItem.get(selectedPost.id) : undefined}
        onClose={() => setSelectedPost(null)}
        onDeleted={handlePostDeleted}
      />
    </Card>
  );
}
