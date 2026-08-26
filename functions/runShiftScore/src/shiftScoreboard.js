function scoreboardFromFindings(findings) {
  const openFindings = [];
  let gapCount = 0;
  let unclearCount = 0;
  let passCount = 0;
  for (const row of findings || []) {
    if (row.status === "gap") {
      gapCount += 1;
      openFindings.push({
        $id: row.$id,
        itemId: row.itemId,
        status: "gap",
      });
    } else if (row.status === "unclear") {
      unclearCount += 1;
      openFindings.push({
        $id: row.$id,
        itemId: row.itemId,
        status: "unclear",
      });
    } else if (row.status === "pass") {
      passCount += 1;
    }
  }
  return { gapCount, unclearCount, passCount, openFindings };
}

function serializeOpenFindings(open) {
  return JSON.stringify(
    (open || []).map((row) => [row.$id, row.itemId, row.status === "gap" ? 0 : 1]),
  );
}

function scoreboardWritePayload(board) {
  return {
    gapCount: board.gapCount,
    unclearCount: board.unclearCount,
    passCount: board.passCount,
    openFindingsJson: serializeOpenFindings(board.openFindings),
  };
}

module.exports = {
  scoreboardFromFindings,
  serializeOpenFindings,
  scoreboardWritePayload,
};
