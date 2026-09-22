// Where InterAct's windows go, given where the controls are.
//
// Separated from main.cjs so it can be exercised against real display geometry
// without booting Electron. Which display the controls are on is Electron's own
// screen.getDisplayMatching — that part is the same call the capture path has
// always used, and capture has never had this bug.

// The bounds the danmaku overlay should take, or null when it is already right.
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

// A window of roughly this size, centred on the screen the teacher is working
// on and never bigger than that screen has room for.
//
// Every window that opens over the lesson — the word cloud, the report, the
// enlarged reviews — should appear on the screen the controls are on. Two of
// them used to give Electron a size and no position, which puts the window
// wherever the platform feels like: on a second monitor that meant the word
// cloud opened on the other screen while the teacher was looking at this one.
function fitAndCentre(workArea, preferredWidth, preferredHeight, margin = 0) {
  const width = Math.min(preferredWidth, workArea.width - margin * 2)
  const height = Math.min(preferredHeight, workArea.height - margin * 2)
  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
  }
}

module.exports = { overlayBoundsFor, fitAndCentre }
