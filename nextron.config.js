// Nextron dev/build configuration.
//
// startupDelay: how long (ms) `nextron dev` waits for the Next.js renderer to
// start listening on its port before giving up. Nextron 10 converts this into
// `retries = startupDelay / 500` for its port check, and the default is 0 —
// meaning ZERO retries, so `npm run dev` fails instantly with
// "Failed to start renderer process with port 8888 in 0ms". Worse, on Windows
// the failure path only kills the npm shim, orphaning `next dev` on port 8888
// (which then had to be killed by hand before the next run).
// 60 s is generous headroom for a cold Next.js compile.
module.exports = {
  startupDelay: 60000,
};
