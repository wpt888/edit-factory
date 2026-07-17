"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Clapperboard, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

type ProductId = "creative" | "studio";

const CREATIVE_URL =
  process.env.NEXT_PUBLIC_BLIPCREATIVE_URL || "https://blipost.com/dashboard";

const PRODUCTS = [
  {
    id: "creative" as const,
    name: "BlipCreative",
    description: "Generate images, video & voice",
    href: CREATIVE_URL,
    icon: Megaphone,
    iconClassName: "bg-orange-500/15 text-orange-500",
    external: true,
  },
  {
    id: "studio" as const,
    name: "BlipStudio",
    description: "Turn scripts and footage into videos, in bulk",
    href: "/pipeline",
    icon: Clapperboard,
    iconClassName: "bg-lime/15 text-lime",
    external: false,
  },
];

export function ProductSwitcher({
  activeProduct,
  compact = false,
  compactMenuPlacement = "bottom",
}: {
  activeProduct: ProductId;
  compact?: boolean;
  compactMenuPlacement?: "bottom" | "side";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active =
    PRODUCTS.find((product) => product.id === activeProduct) ?? PRODUCTS[1];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={
          compact
            ? `Switch product. Current product: ${active.name}`
            : undefined
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center border border-sidebar-border bg-sidebar-accent/45 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
          compact
            ? "size-9 justify-center rounded-lg"
            : "w-full gap-2.5 rounded-lg px-3 py-2.5",
        )}
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            active.iconClassName,
          )}
        >
          <active.icon className="size-4" />
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {active.name}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-sidebar-foreground/50 transition-transform",
                open && "rotate-180",
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Blipost products"
          className={cn(
            "absolute z-50 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground shadow-2xl shadow-black/35",
            compact && compactMenuPlacement === "side"
              ? "top-0 left-12 w-72"
              : compact
                ? "top-[calc(100%+0.5rem)] left-1/2 w-72 -translate-x-1/2"
                : "top-[calc(100%+0.5rem)] left-0 w-full min-w-72",
          )}
        >
          {PRODUCTS.map((product) => {
            const content = (
              <>
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                    product.iconClassName,
                  )}
                >
                  <product.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {product.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-sidebar-foreground/50">
                    {product.description}
                  </span>
                </span>
                {product.id === activeProduct && (
                  <Check className="mt-1 size-4 shrink-0 text-lime" />
                )}
              </>
            );
            const className = cn(
              "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-sidebar-accent",
              product.id === activeProduct && "bg-sidebar-accent/65",
            );
            return product.external ? (
              <a
                key={product.id}
                href={product.href}
                target="_top"
                role="menuitem"
                onClick={(event) => {
                  setOpen(false);
                  if (!window.editFactory?.isDesktop) return;
                  event.preventDefault();
                  void window.editFactory.openExternal(product.href);
                }}
                className={className}
              >
                {content}
              </a>
            ) : (
              <Link
                key={product.id}
                href={product.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={className}
              >
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
