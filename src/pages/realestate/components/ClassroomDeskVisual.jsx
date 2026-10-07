import React, { useState } from 'react';
import deskImage from '../../../assets/realestate/student-desk-neutral-v2.png';
import team1DeskImage from '../../../assets/realestate/student-desk-team1-v2.png';
import team2DeskImage from '../../../assets/realestate/student-desk-team2-v2.png';
import team3DeskImage from '../../../assets/realestate/student-desk-team3-v2.png';
import team4DeskImage from '../../../assets/realestate/student-desk-team4-v2.png';
import team5DeskImage from '../../../assets/realestate/student-desk-team5-v2.png';
import team6DeskImage from '../../../assets/realestate/student-desk-team6-v2.png';
import './classroomScene.css';

const TEAM_NAMES = {
  team1: '1모둠', team2: '2모둠', team3: '3모둠',
  team4: '4모둠', team5: '5모둠', team6: '6모둠',
};

const TEAM_DESK_IMAGES = {
  team1: team1DeskImage, team2: team2DeskImage, team3: team3DeskImage,
  team4: team4DeskImage, team5: team5DeskImage, team6: team6DeskImage,
};

const DeskImage = ({ src }) => {
  const [ready, setReady] = useState(false);
  const reveal = (event) => {
    const image = event.currentTarget;
    if (typeof image.decode === 'function') {
      image.decode().then(() => setReady(true), () => setReady(false));
    } else {
      setReady(true);
    }
  };
  return <img className="classroom-desk__image" src={src} alt="" draggable="false"
    style={{ visibility: ready ? 'visible' : 'hidden' }} onLoad={reveal}
    onError={() => setReady(false)} data-testid="desk-image" />;
};

const ClassroomDeskVisual = ({ label, number, studentName, teamId, rotation = 0,
  selected = false, guided = false, overlapping = false, movingStudent = false, view = 'editor', ownerName, ownerType, priceText, status }) => {
  const isProperty = view === 'property';
  const isViewer = view === 'student' || isProperty;
  const hasCustomLabel = label && label !== `${number}번`;
  const isStateOwner = ownerType ? ownerType === 'state' : !ownerName || ownerName === '국가';
  const imageSrc = isProperty ? deskImage : TEAM_DESK_IMAGES[teamId] || deskImage;
  return (
    <span className={`classroom-desk ${selected ? 'classroom-desk--selected' : ''} ${guided ? 'classroom-desk--guided' : ''} ${overlapping ? 'classroom-desk--overlapping' : ''} ${isViewer ? 'classroom-desk--viewer' : ''} ${isProperty ? 'classroom-desk--property' : ''}`}
      data-team={TEAM_NAMES[teamId] ? teamId : 'none'} data-testid={overlapping ? 'overlapping-desk' : undefined}>
      <span className="classroom-desk__shape" style={{ transform: `rotate(${rotation}deg) scale(1.15)` }} aria-hidden="true" data-testid="desk-shape">
        <DeskImage key={imageSrc} src={imageSrc} />
        {isViewer && (
          <>
            {number != null && <span className="classroom-desk__number">{number}</span>}
            {isProperty ? (
              <>
                <span className={`classroom-desk__status classroom-desk__status--${status?.tone || 'owned'}`}>{status?.label || '보유 중'}</span>
                <span className="classroom-desk__viewer-content">
                  <strong className={isStateOwner ? 'classroom-desk__owner--state' : 'classroom-desk__owner--private'} title={ownerName || '국가'}>{ownerName || '국가'}</strong>
                  <small title={priceText}>{priceText}</small>
                </span>
              </>
            ) : (
              <span className={`classroom-desk__content ${hasCustomLabel ? 'classroom-desk__content--named' : ''}`}>
                {hasCustomLabel && <span className="classroom-desk__label" title={label}>{label}</span>}
                <span className="classroom-desk__student" title={studentName || '미배정'}>{studentName || '미배정'}</span>
              </span>
            )}
          </>
        )}
        {!isViewer && (
          <>
            {number != null && <span className="classroom-desk__number">{number}</span>}
            <span className={`classroom-desk__content ${hasCustomLabel ? 'classroom-desk__content--named' : ''}`}>
              {hasCustomLabel && <span className="classroom-desk__label" title={label}>{label}</span>}
              <span className={`classroom-desk__student ${movingStudent ? 'classroom-desk__student--moving' : ''}`} title={studentName || '미배정'}>{studentName || '미배정'}</span>
            </span>
          </>
        )}
      </span>
      {!isViewer && (
        <>
          {TEAM_NAMES[teamId] && <span className="classroom-desk__team-dot" title={TEAM_NAMES[teamId]} aria-hidden="true" />}
        </>
      )}
      {guided && <span className="classroom-desk__center" aria-hidden="true" />}
    </span>
  );
};

export { TEAM_NAMES };
export default ClassroomDeskVisual;
