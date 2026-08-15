Status: ready-for-agent
Type: task

# 侧边栏分组间距与活动标签高亮

## Problem Statement

当前侧边栏中的分组标题、组内标签和相邻内容连接过紧，用户难以快速辨认分组块的边界。当前活动标签使用系统按钮背景，和普通标签的区别不够明显；悬停状态还可能覆盖活动背景。

## Solution

将“分组块”定义为分组标题及其成员标签组成的完整视觉单元。分组块之间增加统一的视觉间距，分组内部保持连续。所有“活动标签”使用更明显的淡黄色背景，并针对浅色、深色和强制颜色模式提供可读的状态表现。

## User Stories

1. As a 侧边栏用户, I want to distinguish each 分组块 from surrounding tabs, so that I can scan grouped tabs quickly.
2. As a 侧边栏用户, I want adjacent 分组块 to have one consistent boundary, so that spacing does not become unnecessarily large.
3. As a 侧边栏用户, I want a 分组块's title and member tabs to remain visually connected, so that I understand which tabs belong to the group.
4. As a 侧边栏用户, I want collapsed groups to keep the same boundary spacing, so that expanding a group does not change the surrounding visual rhythm unexpectedly.
5. As a 侧边栏用户, I want the first group to avoid an unnecessary top blank area, so that the list uses the narrow panel efficiently.
6. As a 侧边栏用户, I want the last group to retain the existing relationship with the new-tab control, so that the add action does not drift downward.
7. As a 侧边栏用户, I want the spacing to be visual only, so that blank boundaries do not trigger a tab or group action.
8. As a 侧边栏用户, I want drag insertion lines to remain attached to rows, so that spacing does not make drag targets ambiguous.
9. As a 侧边栏用户, I want every active tab to be clearly highlighted, so that I can immediately identify the tab receiving page operations.
10. As a 侧边栏用户, I want active highlighting to work for ordinary, pinned, and grouped tabs, so that the state is consistent across tab types.
11. As a 侧边栏用户, I want active highlighting to remain visible while hovering, so that a hover does not hide the selected state.
12. As a 侧边栏用户, I want context-selection outlines to remain visible together with active highlighting, so that multi-selection feedback is not lost.
13. As a 侧边栏用户, I want grouped active tabs to keep their existing no-rail appearance, so that the prior group styling remains coherent.
14. As a 侧边栏用户, I want the colors to remain readable in light, dark, and forced-color modes, so that the feature is accessible across system themes.

## Implementation Decisions

- Use the existing flat tab list and its state attributes; do not add a wrapper node for each 分组块.
- Apply spacing only at group boundaries using existing collapsed and member-position state attributes. Do not apply a general list gap and do not add margins between group title and members.
- Use a single 4px visual boundary between a group and surrounding ordinary content or another group. Do not add top spacing before the first list item or extra spacing before the new-tab control.
- Keep the blank boundary outside interaction targets and preserve the existing row dimensions and drag indicator placement.
- Define the light-theme active background as `#fff3bf` and the dark-theme active background as `#4a3f18`; keep text color and context-selection outlines readable.
- Make the active background win over hover styling. Preserve the existing grouped-tab rule that removes the left active rail and preserve context-selected outlines.
- In forced-color mode, defer to system colors instead of forcing the yellow palette.
- No tab model, Chrome API, permission, persistence, polling, or remote-code changes are required.

## Testing Decisions

- Test the highest existing seam: rendered side-panel CSS against the existing DOM state attributes and renderer output.
- Add CSS contract coverage for the three boundary cases: non-first group titles, collapsed-group-to-ordinary-tab, and last/single group member-to-ordinary-tab; assert that the list has no general gap.
- Add CSS contract coverage for light and dark active backgrounds, hover exclusion for active rows, preserved context outlines, grouped no-rail behavior, and forced-color system fallback.
- Reuse existing renderer tests for `data-active`, `aria-current`, group positions, collapsed groups, and drag/drop state; no new model seam is needed.
- Verify external behavior at 180px, 240px, 300px, and 360px panel widths, including adjacent groups, ordinary tabs between groups, collapsed groups, single-member groups, pinned tabs, and drag insertion indicators.

## Out of Scope

- Changing group membership, group ordering, tab ordering, or Chrome tab/group APIs.
- Adding animations, persistent spacing preferences, a theme picker, or per-group color customization.
- Changing the count displayed on group titles or the new-tab button dimensions.
- Reworking context menus, search, favicon loading, or startup synchronization.

## Further Notes

The vocabulary uses “分组块” for the complete visual unit and “活动标签” for the tab currently receiving page operations. The implementation should keep these concepts visual and state-derived so the change remains compatible with the existing performance boundary.
