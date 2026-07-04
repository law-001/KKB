// Exists so revalidatePath(`/groups/${groupId}`, 'layout') cascades to every
// nested route (expenses, settle, activity, members) — without it,
// revalidating the group page only refreshes that one page.
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
