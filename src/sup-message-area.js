/// Quick little messaging framework
const L_DEBUG = 0;
const L_INFO = 1;
const L_SUCCESS = 2;
const L_ERROR = 3;

const _levelConfigs = {
    [L_DEBUG]: {
        name: "DEBUG",
        messageClass: "SUP-message-debug",
    },
    [L_INFO]: {
        name: "INFO",
        messageClass: "SUP-message-info",
    },
    [L_SUCCESS]: {
        name: "SUCCESS",
        messageClass: "SUP-message-success",
    },
    [L_ERROR]: {
        name: "ERROR",
        messageClass: "SUP-message-error",
    },
};

const _levelClasses = Object.fromEntries(
    Object.keys(_levelConfigs).map(key => [key, _levelConfigs[key].messageClass])
);

const _levelNames = Object.fromEntries(
    Object.keys(_levelConfigs).map(key => [key, _levelConfigs[key].name])
);

const getLevelMessageClass = (level) => _levelClasses[level];
const getLevelName = (level) => _levelNames[level];
const getMessageArea = () => document.getElementById('SUP-messageArea');
const getToggleButton = (messageArea) => messageArea.querySelector('.SUP-message-toggle');

const hideMessageArea = () => {
    const ma = getMessageArea();
    ma.classList.add("collapsed");
    getToggleButton(ma).classList.add("collapsed");
};

const showMessageArea = () => {
    const ma = getMessageArea();
    ma.classList.remove("collapsed");
    getToggleButton(ma).classList.remove("collapsed");
};

const toggleMessageArea = () => {
    const ma = getMessageArea();
    ma.classList.toggle('collapsed');
    getToggleButton(ma).classList.toggle('collapsed')
};

const addMessage = (level, message) => {
    showMessageArea();
    supLog(`addMessage: ${getLevelName(level)}: ${message}`, level, message);
    const messageContent = document
          .getElementById('SUP-messageArea')
          .querySelector('.SUP-message-content');
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.className = getLevelMessageClass(level);
    messageContent.appendChild(messageElement);
};

const initMessageArea = () => {
    const messageAreaHTML = `
        <div id="SUP-messageArea" class="SUP-message-area collapsed">
            <div class="SUP-message-toggle">Hide</div>
            <div class="SUP-message-content"></div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', messageAreaHTML);
    // Attach the event listener to the toggle
    document.querySelector('.SUP-message-toggle').addEventListener('click', toggleMessageArea);
};

/// End messaging framework
