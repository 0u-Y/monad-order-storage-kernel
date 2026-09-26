# Contributing

Open an issue before changing storage layout or interface semantics. A kernel
change must include a minimized regression test, source and package hash
updates, storage-compatibility analysis, and host-level rollback tests. Do not
replace negative benchmark evidence with a more favorable fixture.

Documentation and example-host changes must preserve the seam: the kernel owns
FIFO storage; the host owns financial policy. Run `npm test` before submitting
a pull request. Self-authored examples are not independent adoption evidence.
