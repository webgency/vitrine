"use client";

import Link from "next/link";
import { useResearchUrl } from "@/hooks/useResearchSession";
import { usePathname } from "next/navigation";
import { IS_STATIC } from "@/lib/config";
import { useCollectionSearch } from "./CollectionSearchContext";

export default function HeaderNav({ alerts, forSale = 0, finalists = 0 }: { alerts?: { total: number; unread: number }; forSale?: number; finalists?: number }) {
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  const collectionUrl = useResearchUrl("collection");
  const valueUrl = useResearchUrl("value");
  const { query, setQuery } = useCollectionSearch();
  const showSearch = pathname === "/";

  // Pills inside one tray read as a single control, so the destinations group
  // together and apart from the Add action. Azalea marks the selected page,
  // which is the one job branding gives pink. Phone pills size around their
  // labels (flex-auto): equal widths crowded the longer labels at 320px.
  //
  // Compare is deliberately not here. It acts on a selection rather than being
  // a place: with nothing picked, the link only reached an empty "select two
  // watches" page. Comparisons start from the collection's selection tray.
  function navClass(active: boolean) {
    return `flex h-8 min-w-0 flex-auto items-center justify-center rounded-full px-1 text-xs font-semibold transition-colors sm:flex-none sm:px-4 sm:text-sm ${
      active ? "bg-azalea text-cocoa-950" : "text-cocoa-600 hover:bg-white/70 hover:text-cocoa-900"
    }`;
  }

  return (
    <nav aria-label="Main navigation" className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:flex-1 lg:justify-end">
      {showSearch && (
        <label className="order-last w-full lg:order-none lg:min-w-0 lg:flex-1 lg:max-w-xs">
          <span className="sr-only">Search collection</span>
          <input
            type="search"
            placeholder="Search collection..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input h-9 rounded-full px-4"
          />
        </label>
      )}
      <div className="flex w-full min-w-0 gap-1 rounded-full bg-cocoa-100 p-1 sm:w-auto">
        <Link href={collectionUrl} aria-current={pathname === "/" ? "page" : undefined} className={navClass(pathname === "/")}>
          Collection
        </Link>
        <Link
          href={valueUrl}
          aria-current={pathname === "/value" ? "page" : undefined}
          className={navClass(pathname === "/value")}
        >
          Value
        </Link>
        {/* Only once something is pinned: an empty Decide is a page that says
            "pin some finalists", which the cards already offer. */}
        {finalists > 0 && (
          <Link href="/decide" aria-current={pathname === "/decide" ? "page" : undefined} className={navClass(pathname === "/decide")}>
            Decide
          </Link>
        )}
        {forSale > 0 && (
          <Link href="/for-sale" aria-current={pathname === "/for-sale" ? "page" : undefined} className={navClass(pathname === "/for-sale")}>
            For sale
          </Link>
        )}
        {!IS_STATIC && (
          <Link
            href="/design"
            aria-current={pathname === "/design" ? "page" : undefined}
            className={navClass(pathname === "/design")}
          >
            Design
          </Link>
        )}
        {/* Settings and unmute controls must remain reachable with an empty
            feed, including when every watch or alert type has been muted. */}
        <Link
          href="/alerts"
          aria-current={pathname === "/alerts" ? "page" : undefined}
          className={navClass(pathname === "/alerts")}
        >
          Alerts
          {alerts && alerts.unread > 0 && (
            <>
              {/* A dot on phones: the pills leave no room for a number
                  beside the label below sm, and it clipped the labels. */}
              <span aria-hidden="true" className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cocoa-900 sm:hidden" />
              <span
                aria-hidden="true"
                className="ml-1.5 hidden rounded-full bg-cocoa-900 px-1.5 text-[10px] font-bold leading-4 tabular-nums text-white sm:inline-block"
              >
                {alerts.unread}
              </span>
              <span className="sr-only"> ({alerts.unread} unread)</span>
            </>
          )}
        </Link>
      </div>
      {!IS_STATIC && (
        <Link href="/watch/new" className="btn-primary absolute right-4 top-5 h-9 whitespace-nowrap rounded-full px-3 lg:static sm:px-4">
          + Add<span className="hidden sm:inline"> watch</span>
        </Link>
      )}
    </nav>
  );
}
