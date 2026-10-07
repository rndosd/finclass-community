"use strict";

const marginBucket = (home, away) => {
    const difference = Math.abs(home - away);
    return difference === 0 ? "draw" : difference === 1 ? "1" : difference <= 3 ? "2-3" : "4+";
};

const validateMargin = (outcome, margin) =>
    outcome === "draw" ? margin === "draw" : ["1", "2-3", "4+"].includes(margin);

// Keep legacy exact-score predictions and stored reward/config field names intact.
const isBonusCorrect = (prediction, result) => {
    if (prediction.predictionType === "margin") {
        return prediction.outcome !== "draw" && prediction.outcome === result.outcome &&
            validateMargin(prediction.outcome, prediction.margin) &&
            prediction.margin === marginBucket(result.homeScore, result.awayScore);
    }
    return prediction.homeScore != null && prediction.awayScore != null &&
        Number(prediction.homeScore) === result.homeScore && Number(prediction.awayScore) === result.awayScore;
};

module.exports = { marginBucket, validateMargin, isBonusCorrect };
