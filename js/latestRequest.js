// latestRequest.js — 비동기 작업에서 마지막 요청만 상태를 갱신하도록 하는 가드
export function createLatestRequest() {
    let activeId = 0;

    return {
        begin() {
            activeId += 1;
            return activeId;
        },
        isCurrent(id) {
            return id === activeId;
        },
    };
}
