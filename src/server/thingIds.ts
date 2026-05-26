import type { T1, T3 } from '@devvit/shared-types/tid.js';

/** Normalize post id for Reddit API (type-only import — no runtime @devvit/shared-types). */
export function toT3(postId: string): T3 {
  return (postId.startsWith('t3_') ? postId : `t3_${postId}`) as T3;
}

/** Normalize comment id for Reddit API. */
export function toT1(commentId: string): T1 {
  return (commentId.startsWith('t1_') ? commentId : `t1_${commentId}`) as T1;
}
