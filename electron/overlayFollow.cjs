// Where the danmaku overlay belongs, given where the controls are.
//
// Separated from main.cjs so it can be exercised against real display
// geometry without booting Electron. Which display the controls are on is
// Electron's own screen.getDisplayMatching — that part is the same call the
// capture path has always used, and capture has never had this bug.

// The bounds the overlay should take, or null when it is already correct.
//
// Compares the rectangle rather than the display id on purpose: a screen that
// changes resolution keeps its id, and an overlay still sized for the old
// resolution is just as wrong as one on the wrong screen.
function overlayBoundsFor(targetDisplayBounds, currentOverlayBounds) {
  if (!targetDisplayBounds) return null
  const current = currentOverlayBounds
  if (current
    && current.x === targetDisplayBounds.x
    && current.y === targetDisplayBounds.y
    && current.width === targetDisplayBounds.width
    && current.height === targetDisplayBounds.height) return null
  return targetDisplayBounds
}

module.exports = { overlayBoundsFor }
