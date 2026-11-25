// Resolve a coalesced chat update after its queued rows have been appended.
// If the reader left the tail before the frame ran, those queued messages must
// be reported as unread instead of disappearing between follow and pause.
export function resolveChatFlush({ wasFollowingTail, isFollowingTail, pendingFollowCount = 0, pendingUnread = 0 }) {
  const follow = !!wasFollowingTail && !!isFollowingTail;
  return {
    follow,
    unread: follow ? 0 : Math.max(0, Number(pendingUnread) || 0) + (wasFollowingTail ? Math.max(0, Number(pendingFollowCount) || 0) : 0),
  };
}
