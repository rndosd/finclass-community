import lottoArtwork from "../../assets/arcade/lotto-v1.webp";
import matchPredictionArtwork from "../../assets/arcade/match-prediction-baseball-v2.png";
import miniQuizArtwork from "../../assets/arcade/mini-quiz-v1.webp";
import nostalgiaPickArtwork from "../../assets/arcade/nostalgia-pick-v1.webp";
import paperPickArtwork from "../../assets/arcade/paperpick-v1.webp";
import rouletteArtwork from "../../assets/arcade/roulette-v1.webp";
import scratchArtwork from "../../assets/arcade/scratch-v1.webp";



const GAME_ARTWORK = {
  scratch: {
    src: scratchArtwork, fallbackSrc: scratchArtwork,
    alt: "카드를 뒤집어 별을 찾는 게임",
  },
  roulette: {
    src: rouletteArtwork, fallbackSrc: rouletteArtwork,
    alt: "다양한 학교 활동이 담긴 과제 룰렛",
  },
  lotto: {
    src: lottoArtwork, fallbackSrc: lottoArtwork,
    alt: "도형 공으로 즐기는 행운 번호 게임",
  },
  paperpick: {
    src: paperPickArtwork, fallbackSrc: paperPickArtwork,
    alt: "색종이 칸에서 별을 찾는 게임",
  },
  nostalgiaPick: {
    src: nostalgiaPickArtwork, fallbackSrc: nostalgiaPickArtwork,
    alt: "학교의 추억 사진을 고르는 게임",
  },
  matchPrediction: {
    src: matchPredictionArtwork,
    fallbackSrc: matchPredictionArtwork,
    alt: "학교 야구장에서 배트와 글러브를 든 두 동물 친구의 야구 승부 예측",
  },
  miniQuiz: {
    src: miniQuizArtwork, fallbackSrc: miniQuizArtwork,
    alt: "OX와 도형으로 푸는 간단 퀴즈",
  },
};

export const getGameArtwork = (gameId) => GAME_ARTWORK[gameId] || null;
