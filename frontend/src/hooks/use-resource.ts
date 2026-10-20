import { useEffect, useState } from "react";

// 依赖变化时取消旧请求，并隐藏旧数据，防止快速切站点/设备时显示串位结果。
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  cacheKey?: number,
) {
  const [result, setResult] = useState<{
    load: typeof load;
    revision: number;
    cacheKey?: number;
    data?: T;
    error?: string;
  }>({ load, revision: 0, cacheKey });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ load, revision, cacheKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            load,
            revision,
            cacheKey,
            error: error instanceof Error ? error.message : "加载失败",
          });
      });
    return () => controller.abort();
  }, [load, revision, cacheKey]);
  return {
    ...(result.load === load &&
    result.revision === revision &&
    result.cacheKey === cacheKey
      ? result
      : {}),
    reload: () => setRevision((x) => x + 1),
  };
}
