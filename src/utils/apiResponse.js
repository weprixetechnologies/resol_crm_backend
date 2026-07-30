class ApiResponse {
  constructor(success, data = null, message = null, error = null) {
    this.success = success;
    if (data) this.data = data;
    if (message) this.message = message;
    if (error) this.error = error;
  }

  static success(data, message) {
    return new ApiResponse(true, data, message);
  }

  static error(code, message) {
    return new ApiResponse(false, null, null, { code, message });
  }
}

module.exports = ApiResponse;
