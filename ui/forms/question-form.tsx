import {
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import type { Question, Task } from "../core/types";
import { useController } from "../components/controller-context";
import { Field } from "./fields";
import { FormSelect } from "./form-select";
import { FormFooter } from "./form-footer";
type Answers = {
  answers: Record<string, string | string[]>;
  custom: Record<string, string>;
};
interface QuestionFieldProps {
  question: Question;
  index: number;
  register: UseFormRegister<Answers>;
  control: Control<Answers>;
}
function QuestionField({
  question,
  index,
  register,
  control,
}: QuestionFieldProps) {
  const custom = useWatch({ control, name: `custom.${index}` }),
    id = `answer-${index}`,
    hasOptions = Boolean(question.options?.length);
  return (
    <>
      <Field id={id} label={question.question}>
        {hasOptions ? (
          <FormSelect
            multiple={question.multiSelect}
            control={control}
            name={`answers.${index}`}
            id={id}
            label={question.question}
            placeholder={
              question.multiSelect ? "Choose answers" : "Choose an answer"
            }
            required={!custom?.trim()}
            options={question.options!.map((option) => ({
              value: option.label,
              label: option.description
                ? `${option.label} — ${option.description}`
                : option.label,
            }))}
            rules={{
              validate: (value) =>
                Boolean(
                  custom?.trim() ||
                  (Array.isArray(value)
                    ? value.length
                    : typeof value === "string" && value.trim()),
                ) || "Answer each question before sending.",
            }}
          />
        ) : (
          <textarea
            id={id}
            required
            {...register(`answers.${index}`, { required: true })}
          />
        )}
      </Field>
      {hasOptions && (
        <Field id={`custom-${index}`} label="Or write your own answer">
          <input id={`custom-${index}`} {...register(`custom.${index}`)} />
        </Field>
      )}
    </>
  );
}
export function QuestionForm({ task }: { task: Task }) {
  const controller = useController(),
    request = task.pending_input!;
  const questions = (
    Array.isArray(request.input.questions)
      ? request.input.questions
      : [{ question: request.input.question ?? "Your response" }]
  ) as Question[];
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Answers>({
    defaultValues: {
      answers: Object.fromEntries(
        questions.map((question, index) => [
          index,
          question.multiSelect ? [] : "",
        ]),
      ),
      custom: {},
    },
  });
  return (
    <form
      onSubmit={handleSubmit((values) =>
        controller.submit(async () => {
          const answers = Object.fromEntries(
            questions.map((question, index) => {
              const preset = values.answers[index],
                answer =
                  values.custom[index]?.trim() ||
                  (Array.isArray(preset) ? preset.join(", ") : preset?.trim());
              if (!answer)
                throw new Error("Answer each question before sending.");
              return [question.question, answer];
            }),
          );
          await controller.tool("submit_agent_input", {
            task_id: task.id,
            request_id: request.id,
            approved: true,
            input: { ...request.input, answers },
          });
        }),
      )}
    >
      {questions.map((question, index) => (
        <QuestionField
          key={index}
          question={question}
          index={index}
          register={register}
          control={control}
        />
      ))}
      {questions.some(
        (question, index) =>
          !question.options?.length && errors.answers?.[index],
      ) && (
        <p className="form-error" role="alert">
          Answer each question before sending.
        </p>
      )}
      <FormFooter label="Send answer" />
    </form>
  );
}
