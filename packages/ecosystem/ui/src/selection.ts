import { useEffect, useState } from "react";
import { z } from "zod";

export const sidebarItemSchema = z.object({
  description: z.string().optional(),
  id: z.string(),
  label: z.string(),
  state: z.enum(["busy", "idle", "offline"]).optional(),
});

export type SidebarItem = z.infer<typeof sidebarItemSchema>;

const selectedIdFromUrl = () =>
  new URLSearchParams(location.search).get("selected");

export const useUrlSelection = (items: SidebarItem[]) => {
  const [selectedId, setSelectedId] = useState(selectedIdFromUrl);
  useEffect(() => {
    const update = () => setSelectedId(selectedIdFromUrl());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const select = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set("selected", id);
    history.replaceState({}, "", url);
    setSelectedId(id);
  };
  return { select, selected };
};
