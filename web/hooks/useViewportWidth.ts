import { useEffect, useState } from 'react';

function readWindowWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return window.innerWidth || 1280;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(readWindowWidth);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setWidth(window.innerWidth || 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}
