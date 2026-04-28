export function createStartupLoadController() {
  let isLoading = true;
  let userMutatedDuringLoad = false;

  return {
    recordUserMutation() {
      if (isLoading) {
        userMutatedDuringLoad = true;
      }
    },
    shouldApplyLoadedState() {
      return !userMutatedDuringLoad;
    },
    completeLoad({ currentState, loaded }) {
      isLoading = false;
      if (userMutatedDuringLoad) {
        return {
          state: currentState,
          syncStatus: undefined,
          shouldApplyLoadedSyncStatus: false,
        };
      }
      return {
        state: loaded.state,
        syncStatus: loaded.syncStatus,
        shouldApplyLoadedSyncStatus: true,
      };
    },
  };
}
