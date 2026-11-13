using System.Text.Json;
using System.Text.Json.Serialization;

namespace Meili.Automation;

/// <summary>One JSON contract for CLI, MCP and local automation. Non-finite numeric values are null.</summary>
public static class WireJson
{
    public static JsonSerializerOptions Options { get; } = Create();
    private static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
        o.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
        o.Converters.Add(new FiniteDouble());
        return o;
    }
    public static JsonElement Element(object? value) => JsonSerializer.SerializeToElement(value, Options);
    public static T Read<T>(JsonElement value) => value.Deserialize<T>(Options) ?? throw new ArgumentException("Input must not be null.");
    public static object Success(object? value) => new { schemaVersion = 1, success = true, generatedAt = DateTimeOffset.UtcNow, data = value, numberEncoding = "Non-finite values are null; inspect unbounded flags, incomplete bars and calculation status." };
    public static object Error(Exception e) => new { schemaVersion = 1, success = false, error = new { code = Code(e), message = SafeMessage(e) } };
    public static string Code(Exception e) => e switch
    {
        Core.Settings.DataConflictException => "data_conflict",
        ArgumentException or JsonException or FormatException or OverflowException => "invalid_arguments",
        OperationCanceledException => "cancelled",
        UnauthorizedAccessException => "permission_denied",
        IOException => "io_error",
        Meili.Data.Routing.AllSourcesFailedException or Meili.Data.Http.DataSourceException => "data_source_error",
        _ => "operation_failed"
    };
    private static string SafeMessage(Exception e) => e is Meili.Data.Routing.AllSourcesFailedException all ? $"All sources failed for {all.Capability}: {string.Join(", ", all.Errors.Select(x => x.Source))}. Check connectivity and provider availability."
        : e is Meili.Data.Http.DataSourceException source ? $"Source {source.SourceId}: {source.Kind} (HTTP {source.StatusCode?.ToString() ?? "unknown"})."
        : e is ArgumentException or JsonException or FormatException or OverflowException or Core.Settings.DataConflictException ? e.Message
        : e is OperationCanceledException ? "Operation cancelled or timed out."
        : e is IOException ? "Local file operation failed. Check the data directory and file permissions."
        : e is UnauthorizedAccessException ? "This operation is not permitted. MCP writes require --allow-writes."
        : "Operation failed. Check data source connectivity or local diagnostic logs.";
    private sealed class FiniteDouble : JsonConverter<double>
    {
        public override double Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.GetDouble();
        public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
        { if (double.IsFinite(value)) writer.WriteNumberValue(value); else writer.WriteNullValue(); }
    }
}
