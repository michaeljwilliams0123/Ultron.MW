# Browser upload lifetime

Selecting an approved file fences every preallocated page and unknown page in
the isolated runtime. Sibling pages can receive file bytes through
BroadcastChannel, so registering a page does not exempt it. The fence permits
one owner-approved multipart POST and one exact main-frame receipt navigation
derived from its same-origin redirect response.

After the executor verifies the submit and durably records its receipt, the
driver closes every old browser context. The launcher allocates fresh contexts
before later plan steps run. Cookies, local storage, page handles and selected
file data are never copied. Only the response-derived receipt URL can be
revisited; a page-controlled URL or history change cannot become a new request.
Sites that require authentication may need another owner takeover.

All preallocated tabs and windows are reset. A plan must reopen secondary slots
before using them again. A direct POST response without a redirect leaves the
fresh primary page at `about:blank`; the next step must explicitly navigate.
Otherwise the executor returns `browser-restart-required` before another action.
The standalone Page adapter also returns that status if it has no clean-session
factory. A verified receipt remains durable when context replacement fails and
the submit is never replayed.

Selection failures, failed actions, denied submit consent, session expiration
and other exits close any armed contexts. A context-close failure prevents a
replacement from opening. The driver never clears a fence while an old page can
retain the file. The owner runner still closes the browser at the end of the run.

These source regressions exercise lifecycle boundaries with isolated fixtures.
They do not establish live owner-authenticated transfer acceptance for issue #65.
