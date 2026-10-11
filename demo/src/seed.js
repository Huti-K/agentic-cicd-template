export const PROJECTS = [
  { id: 'orbit', code: 'ORB', name: 'Orbit Commerce', description: 'A faster, friendlier checkout for independent stores.', repository: 'northstar/orbit-commerce', color: 'violet', icon: 'orbit', leadId: 'maya' },
  { id: 'atlas', code: 'ATL', name: 'Atlas Mobile', description: 'Make every trip feel a little more effortless.', repository: 'northstar/atlas-mobile', color: 'blue', icon: 'compass', leadId: 'leo' },
  { id: 'beacon', code: 'BCN', name: 'Beacon API', description: 'Reliable infrastructure for the next wave of products.', repository: 'northstar/beacon-api', color: 'orange', icon: 'layers', leadId: 'alex' },
  { id: 'forma', code: 'FRM', name: 'Forma Design', description: 'One thoughtful design language, across every surface.', repository: 'northstar/forma-system', color: 'pink', icon: 'grid', leadId: 'sara' },
];
export const PEOPLE = [
  { id: 'alex', name: 'Alex Morgan', initials: 'AM', color: 'violet' },
  { id: 'maya', name: 'Maya Chen', initials: 'MC', color: 'pink' },
  { id: 'leo', name: 'Leo Fischer', initials: 'LF', color: 'blue' },
  { id: 'sara', name: 'Sara Ahmed', initials: 'SA', color: 'orange' },
  { id: 'jules', name: 'Jules Rivera', initials: 'JR', color: 'green' },
];
const tickets = [
  ['ORB-142','orbit','Keep discount codes after checkout refresh','in_review','high','maya','Checkout','A customer should keep their applied discount when refreshing the checkout. Persist the code for the active cart and revalidate it before payment.'],
  ['ORB-141','orbit','Add express checkout with Apple Pay','in_progress','high','alex','Payments','Offer express checkout for supported browsers. Keep the standard payment flow available and announce payment errors accessibly.'],
  ['ORB-140','orbit','Show delivery estimates on product pages','todo','medium','jules','Experience','Use the selected shipping region to show an estimated delivery window before checkout.'],
  ['ORB-139','orbit','Improve empty cart recommendations','backlog','low','maya','Experience','Help customers discover relevant products when their cart is empty.'],
  ['ORB-138','orbit','Make product images keyboard accessible','done','medium','sara','Accessibility','Support keyboard navigation through product images and expose meaningful image descriptions.'],
  ['ORB-137','orbit','Fix duplicate order confirmation emails','done','urgent','alex','Reliability','Prevent webhook retries from sending the same order confirmation twice.'],
  ['ATL-086','atlas','Handle offline changes to saved trips','in_review','urgent','leo','Offline','Queue changes while offline and reconcile them without overwriting newer edits after reconnecting.'],
  ['ATL-085','atlas','Add a map preview to trip cards','in_progress','medium','jules','Discovery','Show a lightweight preview for saved destinations without delaying the trip list.'],
  ['ATL-084','atlas','Support larger text in the itinerary','todo','high','sara','Accessibility','Keep itinerary actions visible and readable at larger system text sizes.'],
  ['ATL-083','atlas','Introduce collaborative trip notes','backlog','medium','','Collaboration','Let a trip group leave shared notes for each stop. Show who last edited a note.'],
  ['ATL-082','atlas','Remember the last selected trip','done','low','leo','Experience','Restore the last selected trip when reopening the application.'],
  ['BCN-204','beacon','Make webhook retries idempotent','in_review','high','alex','Reliability','Retry transient webhook failures using an idempotency key. The receiving service must see one logical event.'],
  ['BCN-203','beacon','Add rate-limit response headers','in_progress','medium','leo','Platform','Return request limits, remaining quota, and reset time consistently on API responses.'],
  ['BCN-202','beacon','Rotate sandbox tokens automatically','todo','high','alex','Security','Allow safe rotation of fictional sandbox credentials without interrupting active example sessions.'],
  ['BCN-201','beacon','Document cursor pagination examples','backlog','low','','Documentation','Add clear examples for moving forward and backward through a paginated collection.'],
  ['BCN-200','beacon','Add health checks to worker queues','done','medium','jules','Observability','Expose worker readiness separately from process liveness.'],
  ['FRM-032','forma','Improve contrast on secondary buttons','in_review','medium','sara','Accessibility','Meet contrast requirements in both themes while preserving the secondary visual hierarchy.'],
  ['FRM-031','forma','Build a reusable command menu','in_progress','medium','maya','Components','Create an accessible command menu with keyboard navigation and grouped results.'],
  ['FRM-030','forma','Add loading states to the table component','todo','low','sara','Components','Provide a stable skeleton layout for tables while data is loading.'],
  ['FRM-029','forma','Publish the first icon guidelines','done','low','maya','Documentation','Define sizing, optical alignment, and accessible labeling for product icons.'],
];
export function createSeed(now = new Date().toISOString()) {
  const time = new Date(now).valueOf();
  const ago = (hours) => new Date(time - hours * 3_600_000).toISOString();
  const workspace = {
    version: 1, nextEvent: 7,
    projects: structuredClone(PROJECTS), people: structuredClone(PEOPLE),
    tickets: tickets.map(([id, projectId, title, status, priority, assigneeId, label, description], index) => ({
      id, projectId, title, status, priority, assigneeId, labels: [label], description,
      dueDate: '', createdAt: ago(120 + index * 3), updatedAt: ago(index * 2 + 1),
    })),
    pullRequests: [
      { id: 'pr-orbit-89', number: 89, projectId: 'orbit', ticketId: 'ORB-142', title: 'Persist discounts across checkout refreshes', branch: 'fix/persist-cart-discount', authorId: 'maya', state: 'open', checks: 'passed', review: 'changes_requested', issue: { severity: 'P2', path: 'src/checkout/cart.ts', line: 48, message: 'The restored discount is applied without checking its expiry. Revalidate the code before calculating the total.' }, checkFailure: false, files: 4, additions: 126, deletions: 38, updatedAt: ago(1) },
      { id: 'pr-atlas-56', number: 56, projectId: 'atlas', ticketId: 'ATL-086', title: 'Reconcile saved trips after reconnecting', branch: 'fix/offline-trip-sync', authorId: 'leo', state: 'open', checks: 'failed', review: 'pending', issue: { severity: 'P1', path: 'src/sync/reconcile.ts', line: 72, message: 'An older offline edit replaces newer server changes. Compare revisions and preserve the newer value when resolving conflicts.' }, checkFailure: true, files: 7, additions: 284, deletions: 91, updatedAt: ago(2) },
      { id: 'pr-beacon-112', number: 112, projectId: 'beacon', ticketId: 'BCN-204', title: 'Deduplicate webhook retries by event ID', branch: 'fix/idempotent-webhooks', authorId: 'alex', state: 'open', checks: 'passed', review: 'approved', issue: null, checkFailure: false, files: 3, additions: 98, deletions: 24, updatedAt: ago(3) },
      { id: 'pr-forma-34', number: 34, projectId: 'forma', ticketId: 'FRM-032', title: 'Raise contrast for secondary button tokens', branch: 'fix/secondary-button-contrast', authorId: 'sara', state: 'open', checks: 'passed', review: 'pending', issue: null, checkFailure: false, files: 5, additions: 42, deletions: 19, updatedAt: ago(4) },
      { id: 'pr-orbit-87', number: 87, projectId: 'orbit', ticketId: 'ORB-138', title: 'Add accessible product gallery controls', branch: 'fix/gallery-keyboard', authorId: 'sara', state: 'merged', checks: 'passed', review: 'approved', issue: null, checkFailure: false, files: 4, additions: 87, deletions: 21, updatedAt: ago(18) },
      { id: 'pr-orbit-86', number: 86, projectId: 'orbit', ticketId: 'ORB-137', title: 'Prevent duplicate order confirmations', branch: 'fix/order-email-deduplication', authorId: 'alex', state: 'merged', checks: 'passed', review: 'approved', issue: null, checkFailure: false, files: 2, additions: 63, deletions: 12, updatedAt: ago(24) },
      { id: 'pr-atlas-54', number: 54, projectId: 'atlas', ticketId: 'ATL-082', title: 'Restore the last active trip', branch: 'feat/remember-active-trip', authorId: 'leo', state: 'merged', checks: 'passed', review: 'approved', issue: null, checkFailure: false, files: 3, additions: 51, deletions: 8, updatedAt: ago(32) },
      { id: 'pr-beacon-110', number: 110, projectId: 'beacon', ticketId: 'BCN-200', title: 'Expose worker readiness checks', branch: 'feat/worker-health', authorId: 'jules', state: 'merged', checks: 'passed', review: 'approved', issue: null, checkFailure: false, files: 6, additions: 142, deletions: 27, updatedAt: ago(40) },
    ],
    activity: [
      { id: 'event-6', actorId: 'agent', message: 'Requested changes on Orbit PR #89', targetType: 'pr', targetId: 'pr-orbit-89', at: ago(1) },
      { id: 'event-5', actorId: 'leo', message: 'Opened a pull request for offline trip sync', targetType: 'pr', targetId: 'pr-atlas-56', at: ago(2) },
      { id: 'event-4', actorId: 'agent', message: 'Approved Beacon PR #112. Ready to merge.', targetType: 'pr', targetId: 'pr-beacon-112', at: ago(3) },
      { id: 'event-3', actorId: 'sara', message: 'Moved secondary button contrast into review', targetType: 'ticket', targetId: 'FRM-032', at: ago(4) },
      { id: 'event-2', actorId: 'maya', message: 'Started work on the command menu', targetType: 'ticket', targetId: 'FRM-031', at: ago(6) },
      { id: 'event-1', actorId: 'sara', message: 'Merged the accessible gallery update', targetType: 'pr', targetId: 'pr-orbit-87', at: ago(18) },
    ],
  };
  return workspace;
}
