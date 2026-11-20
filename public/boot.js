(function () {
  if (!Object.hasOwn) {
    Object.hasOwn = function (object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    };
  }
  if (window.AbortController && window.AbortSignal && !AbortSignal.timeout) {
    AbortSignal.timeout = function (milliseconds) {
      var controller = new AbortController();
      setTimeout(function () {
        controller.abort(new DOMException('Connection timed out', 'TimeoutError'));
      }, milliseconds);
      return controller.signal;
    };
  }

  var timer = setTimeout(function () {
    var status = document.getElementById('boot-status');
    var message = document.getElementById('active-room-list');
    status.hidden = false;
    if (message.getAttribute('data-loading') === 'true') {
      message.textContent = '房间列表暂未加载。';
    }
  }, 7000);
  window.addEventListener('jianke-ready', function () {
    clearTimeout(timer);
    document.getElementById('boot-status').hidden = true;
  });
}());
