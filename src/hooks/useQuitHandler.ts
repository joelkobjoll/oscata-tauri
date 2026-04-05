import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../lib/transport";

interface QuitRequestedPayload {
  active: number;
}

export function useQuitHandler() {
  const [quitDialogVisible, setQuitDialogVisible] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;

    let unlistenFn: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<QuitRequestedPayload>("app:quit-requested", ({ payload }) => {
        setActiveCount(payload.active);
        setQuitDialogVisible(true);
      }).then((fn) => {
        unlistenFn = fn;
      });
    });

    return () => {
      unlistenFn?.();
    };
  }, []);

  const confirmQuit = useCallback(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("quit_app").catch(() => {});
    });
  }, []);

  const cancelQuit = useCallback(() => {
    setQuitDialogVisible(false);
  }, []);

  return { quitDialogVisible, activeCount, confirmQuit, cancelQuit };
}
