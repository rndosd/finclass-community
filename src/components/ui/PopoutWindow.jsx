import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_FEATURES = {
  popup: 'yes',
  width: 1600,
  height: 980,
};

const buildFeatures = (features) => {
  if (typeof features === 'string') return features;
  return Object.entries(features)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
};

const copyStylesToWindow = (sourceDoc, targetDoc) => {
  const nodes = sourceDoc.querySelectorAll('link[rel="stylesheet"], style');
  nodes.forEach((node) => {
    targetDoc.head.appendChild(node.cloneNode(true));
  });
};

const PopoutWindow = ({
  isOpen,
  onClose,
  title = 'Finclass',
  windowName = 'finclass-popout',
  features = DEFAULT_FEATURES,
  providedWindow = null,
  onOpenFail,
  children,
}) => {
  const [externalWindow, setExternalWindow] = useState(null);
  const container = useMemo(() => document.createElement('div'), []);
  const onCloseRef = useRef(onClose);
  const onOpenFailRef = useRef(onOpenFail);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onOpenFailRef.current = onOpenFail;
  }, [onOpenFail]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const newWindow =
      providedWindow && !providedWindow.closed
        ? providedWindow
        : window.open('', windowName, buildFeatures(features));

    if (!newWindow) {
      onOpenFailRef.current?.();
      return undefined;
    }

    newWindow.document.title = title;
    newWindow.document.body.style.margin = '0';
    newWindow.document.body.className = document.body.className;

    copyStylesToWindow(document, newWindow.document);
    newWindow.document.body.appendChild(container);
    newWindow.focus();

    const handleClose = () => onCloseRef.current?.();
    newWindow.addEventListener('beforeunload', handleClose);
    setExternalWindow(newWindow);

    return () => {
      newWindow.removeEventListener('beforeunload', handleClose);
      if (container.parentNode === newWindow.document.body) {
        newWindow.document.body.removeChild(container);
      }
      if (!newWindow.closed) newWindow.close();
      setExternalWindow(null);
    };
  }, [container, features, isOpen, providedWindow, title, windowName]);

  if (!isOpen || !externalWindow) return null;
  return createPortal(children, container);
};

export default PopoutWindow;
