// Non-browser regression coverage for chat follow-tail and unread batching.
import assert from 'node:assert/strict';
import { resolveChatFlush } from '../../src/ui/chat-scroll.mjs';

assert.deepEqual(resolveChatFlush({ wasFollowingTail: true, isFollowingTail: true, pendingFollowCount: 5 }),
  { follow: true, unread: 0 }, 'new messages keep the reader at the bottom by default');
assert.deepEqual(resolveChatFlush({ wasFollowingTail: true, isFollowingTail: false, pendingFollowCount: 3 }),
  { follow: false, unread: 3 }, 'messages queued before a manual scroll are counted unread');
assert.deepEqual(resolveChatFlush({ wasFollowingTail: false, isFollowingTail: false, pendingUnread: 4 }),
  { follow: false, unread: 4 }, 'messages arriving while reading older history stay unread');
assert.deepEqual(resolveChatFlush({ wasFollowingTail: false, isFollowingTail: true, pendingUnread: 0 }),
  { follow: false, unread: 0 }, 'a manually returned-to-bottom state is handled by the scroll listener');

console.log('OK - automatic follow, scroll-up race, unread batching, and return-to-bottom state');
